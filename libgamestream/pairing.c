/*
 * This file is part of Moonlight Embedded.
 *
 * Copyright (C) 2015 Iwan Timmer
 *
 * Moonlight is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 3 of the License, or
 * (at your option) any later version.
 *
 * Moonlight is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Moonlight; if not, see <http://www.gnu.org/licenses/>.
 */

#include "http.h"
#include "mkcert.h"
#include "pairing.h"
#include "errors.h"

#include <sys/stat.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <limits.h>
#include <openssl/sha.h>
#include <openssl/aes.h>
#include <openssl/rand.h>
#include <openssl/evp.h>
#include <openssl/x509.h>
#include <openssl/pem.h>
#include <openssl/err.h>

const char* gs_error;

extern X509 *g_Cert;
extern EVP_PKEY *g_PrivateKey;
extern char* g_UniqueId;
extern char* g_CertHex;

// Pairing fields are scalar values. Bound every search by the received length.
static int xml_search(char* data, size_t len, char* node, char** result) {
    char startTag[256], endTag[256];
    *result = NULL;
    if (!data || !node || strlen(node) > 250 || len == SIZE_MAX ||
        memchr(data, 0, len) != NULL) return GS_INVALID;
    char* copy = malloc(len + 1);
    if (!copy) return GS_OUT_OF_MEMORY;
    memcpy(copy, data, len);
    copy[len] = 0;
    snprintf(startTag, sizeof(startTag), "<%s>", node);
    snprintf(endTag, sizeof(endTag), "</%s>", node);
    char* start = strstr(copy, startTag);
    char* end = strstr(copy, endTag);
    int ret = GS_INVALID;
    if (start && end && end >= start + strlen(startTag) &&
        !strstr(start + strlen(startTag), startTag) &&
        !strstr(end + strlen(endTag), endTag)) {
        start += strlen(startTag);
        if (memchr(start, '<', (size_t)(end-start)) == NULL) {
            size_t count = (size_t)(end - start);
            *result = malloc(count + 1);
            if (*result) {
                memcpy(*result, start, count);
                (*result)[count] = 0;
                ret = GS_OK;
            } else ret = GS_OUT_OF_MEMORY;
        }
    }
    free(copy);
    return ret;
}

static int hex_nibble(unsigned char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static bool decode_hex(const char* hex, unsigned char* out, size_t size) {
    if (!hex || strlen(hex) != size * 2) return false;
    for (size_t i = 0; i < size; i++) {
        int hi = hex_nibble(hex[i*2]), lo = hex_nibble(hex[i*2+1]);
        if (hi < 0 || lo < 0) return false;
        out[i] = (unsigned char)((hi << 4) | lo);
    }
    return true;
}

static bool challenge_hash(int version, const unsigned char* challenge,
                           X509* cert, const unsigned char* secret,
                           unsigned char* digest) {
    const ASN1_BIT_STRING* signature = NULL;
    X509_get0_signature(&signature, NULL, cert);
    if (!signature || signature->length <= 0) return false;
    EVP_MD_CTX* ctx = EVP_MD_CTX_create();
    if (!ctx) return false;
    unsigned int size = 0;
    bool ok = EVP_DigestInit_ex(ctx, version >= 7 ? EVP_sha256() : EVP_sha1(), NULL) == 1 &&
        EVP_DigestUpdate(ctx, challenge, 16) == 1 &&
        EVP_DigestUpdate(ctx, signature->data, signature->length) == 1 &&
        EVP_DigestUpdate(ctx, secret, 16) == 1 &&
        EVP_DigestFinal_ex(ctx, digest, &size) == 1 && size == (version >= 7 ? 32u : 20u);
    EVP_MD_CTX_destroy(ctx);
    return ok;
}

static void bytes_to_hex(unsigned char *in, char *out, size_t len) {
    for (int i = 0; i < len; i++) {
        sprintf(out + i * 2, "%02x", in[i]);
    }
    out[len * 2] = 0;
}

static int sign_it(const unsigned char *msg, size_t mlen, unsigned char **sig, size_t *slen, EVP_PKEY *pkey) {
    int result = GS_FAILED;
    
    *sig = NULL;
    *slen = 0;
    
    EVP_MD_CTX *ctx = EVP_MD_CTX_create();
    if (ctx == NULL)
        return GS_FAILED;
    
    const EVP_MD *md = EVP_get_digestbyname("SHA256");
    if (md == NULL)
        goto cleanup;
    
    int rc = EVP_DigestInit_ex(ctx, md, NULL);
    if (rc != 1)
        goto cleanup;
    
    rc = EVP_DigestSignInit(ctx, NULL, md, NULL, pkey);
    if (rc != 1)
        goto cleanup;
    
    rc = EVP_DigestSignUpdate(ctx, msg, mlen);
    if (rc != 1)
        goto cleanup;
    
    size_t req = 0;
    rc = EVP_DigestSignFinal(ctx, NULL, &req);
    if (rc != 1 || !(req > 0))
        goto cleanup;
    
    *sig = OPENSSL_malloc(req);
    if (*sig == NULL)
        goto cleanup;
    
    *slen = req;
    rc = EVP_DigestSignFinal(ctx, *sig, slen);
    if (rc != 1 || req != *slen)
        goto cleanup;
    
    result = GS_OK;
    
cleanup:
    EVP_MD_CTX_destroy(ctx);
    if (result != GS_OK) {
        OPENSSL_free(*sig);
        *sig = NULL;
        *slen = 0;
    }
    
    return result;
}

static bool verifySignature(const unsigned char *data, int dataLength, unsigned char *signature, int signatureLength, X509 *cert) {
    EVP_PKEY* pubKey = cert ? X509_get_pubkey(cert) : NULL;
    EVP_MD_CTX* ctx = EVP_MD_CTX_create();
    bool ok = pubKey && ctx && EVP_PKEY_base_id(pubKey) == EVP_PKEY_RSA &&
        EVP_PKEY_size(pubKey) == signatureLength &&
        EVP_DigestVerifyInit(ctx, NULL, EVP_sha256(), NULL, pubKey) == 1 &&
        EVP_DigestVerifyUpdate(ctx, data, dataLength) == 1 &&
        EVP_DigestVerifyFinal(ctx, signature, signatureLength) == 1;
    EVP_PKEY_free(pubKey);
    EVP_MD_CTX_destroy(ctx);
    return ok;
}

X509* get_cert(PHTTP_DATA data) {
    char* hex = NULL;
    if (!data || xml_search(data->memory, data->size, "plaincert", &hex) != GS_OK) return NULL;
    size_t n = strlen(hex) / 2;
    unsigned char* pem = n > 0 && n <= INT_MAX ? malloc(n) : NULL;
    X509* cert = NULL;
    if (pem && decode_hex(hex, pem, n)) {
        BIO* bio = BIO_new_mem_buf(pem, (int)n);
        if (bio) { cert = PEM_read_bio_X509(bio, NULL, NULL, NULL); BIO_free(bio); }
    }
    free(pem);
    free(hex);
    return cert;
}

static char* x509_to_curl_ppk_string(X509* cert) {
    BIO* bio = BIO_new(BIO_s_mem());
    EVP_PKEY* key = X509_get_pubkey(cert);
    char* result = NULL;
    if (bio && key && i2d_PUBKEY_bio(bio, key) == 1) {
        BUF_MEM* mem = NULL;
        BIO_get_mem_ptr(bio, &mem);
        unsigned char hash[32];
        if (mem && SHA256((unsigned char*)mem->data, mem->length, hash)) {
            result = malloc(8 + 44 + 1);
            if (result) {
                memcpy(result, "sha256//", 8);
                EVP_EncodeBlock((unsigned char*)result+8, hash, sizeof(hash));
            }
        }
    }
    EVP_PKEY_free(key);
    BIO_free(bio);
    return result;
}

// Safely wraps IPv6 addresses in brackets for URL construction.
// IPv4 addresses and DNS hostnames do not contain colons, so they are untouched.
static void format_address_for_url(const char* address, char* host_for_url, size_t max_len) {
  if (strchr(address, ':') != NULL && address[0] != '[') {
      snprintf(host_for_url, max_len, "[%s]", address);
  } else {
      snprintf(host_for_url, max_len, "%s", address);
  }
}

static unsigned short sanitize_http_port(unsigned short httpPort) {
  if (httpPort == 0) {
    return 47989;
  }

  if (httpPort <= 5 || httpPort > 65514) {
    return 47989;
  }

  return httpPort;
}

int gs_unpair(const char* address, unsigned short httpPort) {
  int ret = GS_OK;
  char url[4096];
  unsigned short sanitizedHttpPort = sanitize_http_port(httpPort);
  PHTTP_DATA data = http_create_data();
  if (data == NULL)
    return GS_OUT_OF_MEMORY;

  char host_for_url[256];
  format_address_for_url(address, host_for_url, sizeof(host_for_url));

  snprintf(url, sizeof(url), "http://%s:%u/unpair?uniqueid=%s", host_for_url, sanitizedHttpPort, g_UniqueId);
  ret = http_request(url, NULL, data);

  http_free_data(data);
  return ret;
}

int gs_pair(int serverMajorVersion, const char* address, unsigned short httpPort, const char* pin, char** curl_ppk_string) {
  if (!curl_ppk_string) return GS_INVALID;
  *curl_ppk_string = NULL;
  if (!pin || strlen(pin) != 4 || !g_Cert || !g_PrivateKey) return GS_INVALID;
  int ret = GS_OK;
  unsigned char* signature = NULL;
  size_t s_len = 0;
  char* result = NULL;
  X509* server_cert = NULL;
  char url[4096];
  unsigned short sanitizedHttpPort = sanitize_http_port(httpPort);
  unsigned char salt_data[16];
  char salt_hex[33];
  if (RAND_bytes(salt_data, 16) != 1) return GS_FAILED;
  bytes_to_hex(salt_data, salt_hex, 16);

  char host_for_url[256];
  format_address_for_url(address, host_for_url, sizeof(host_for_url));

  snprintf(url, sizeof(url), "http://%s:%u/pair?uniqueid=%s&devicename=roth&updateState=1&phrase=getservercert&salt=%s&clientcert=%s", host_for_url, sanitizedHttpPort, g_UniqueId, salt_hex, g_CertHex);
  PHTTP_DATA data = http_create_data();
  if (data == NULL)
    return GS_OUT_OF_MEMORY;
  else if ((ret = http_request(url, NULL, data)) != GS_OK)
    goto cleanup;

  if ((ret = xml_search(data->memory, data->size, "paired", &result)) != GS_OK)
    goto cleanup;

  if (strcmp(result, "1") != 0) {
    ret = GS_FAILED;
    goto cleanup;
  }

  free(result);
  result = NULL;
  server_cert = get_cert(data);
  if (server_cert == NULL) {
    ret = GS_FAILED;
    goto cleanup;
  }

  unsigned char salt_pin[20];
  unsigned char aes_key_hash[32];
  AES_KEY enc_key, dec_key;
  memcpy(salt_pin, salt_data, 16);
  memcpy(salt_pin+16, pin, 4);

  int hash_length = serverMajorVersion >= 7 ? 32 : 20;
  if (serverMajorVersion >= 7)
    SHA256(salt_pin, 20, aes_key_hash);
  else
    SHA1(salt_pin, 20, aes_key_hash);

  if (AES_set_encrypt_key(aes_key_hash, 128, &enc_key) != 0 ||
      AES_set_decrypt_key(aes_key_hash, 128, &dec_key) != 0) {
    ret = GS_FAILED; goto cleanup;
  }

  unsigned char challenge_data[16];
  unsigned char challenge_enc[16];
  char challenge_hex[33];
  if (RAND_bytes(challenge_data, 16) != 1) { ret = GS_FAILED; goto cleanup; }
  AES_encrypt(challenge_data, challenge_enc, &enc_key);
  bytes_to_hex(challenge_enc, challenge_hex, 16);

  snprintf(url, sizeof(url), "http://%s:%u/pair?uniqueid=%s&devicename=roth&updateState=1&clientchallenge=%s", host_for_url, sanitizedHttpPort, g_UniqueId, challenge_hex);
  if ((ret = http_request(url, NULL, data)) != GS_OK)
    goto cleanup;

  free(result);
  result = NULL;
  if ((ret = xml_search(data->memory, data->size, "paired", &result)) != GS_OK)
    goto cleanup;

  if (strcmp(result, "1") != 0) {
    ret = GS_FAILED;
    goto cleanup;
  }

  free(result);
  result = NULL;
  if (xml_search(data->memory, data->size, "challengeresponse", &result) != GS_OK) {
    ret = GS_INVALID;
    goto cleanup;
  }

  unsigned char challenge_response_data_enc[48];
  unsigned char challenge_response_data[48];
  if (!decode_hex(result, challenge_response_data_enc, sizeof(challenge_response_data_enc))) {
    ret = GS_INVALID; goto cleanup;
  }

  for (int i = 0; i < 48; i += 16) {
    AES_decrypt(&challenge_response_data_enc[i], &challenge_response_data[i], &dec_key);
  }

  unsigned char client_secret_data[16];
  if (RAND_bytes(client_secret_data, 16) != 1) { ret = GS_FAILED; goto cleanup; }

  unsigned char challenge_response_hash[32] = {0};
  unsigned char challenge_response_hash_enc[32];
  char challenge_response_hex[65];
  if (!challenge_hash(serverMajorVersion, challenge_response_data + hash_length,
                      g_Cert, client_secret_data, challenge_response_hash)) {
    ret = GS_FAILED; goto cleanup;
  }

  for (int i = 0; i < 32; i += 16) {
    AES_encrypt(&challenge_response_hash[i], &challenge_response_hash_enc[i], &enc_key);
  }
  bytes_to_hex(challenge_response_hash_enc, challenge_response_hex, 32);

  snprintf(url, sizeof(url), "http://%s:%u/pair?uniqueid=%s&devicename=roth&updateState=1&serverchallengeresp=%s", host_for_url, sanitizedHttpPort, g_UniqueId, challenge_response_hex);
  if ((ret = http_request(url, NULL, data)) != GS_OK)
    goto cleanup;

  free(result);
  result = NULL;
  if ((ret = xml_search(data->memory, data->size, "paired", &result)) != GS_OK)
    goto cleanup;

  if (strcmp(result, "1") != 0) {
    ret = GS_FAILED;
    goto cleanup;
  }

  free(result);
  result = NULL;
  if (xml_search(data->memory, data->size, "pairingsecret", &result) != GS_OK) {
    ret = GS_INVALID;
    goto cleanup;
  }

  unsigned char pairing_secret[16 + 256];
  if (!decode_hex(result, pairing_secret, sizeof(pairing_secret))) {
    ret = GS_INVALID; goto cleanup;
  }

  if (!verifySignature(pairing_secret, 16, pairing_secret+16, 256, server_cert)) {
    ret = GS_FAILED;
    goto cleanup;
  }

  unsigned char expected_hash[32] = {0};
  if (!challenge_hash(serverMajorVersion, challenge_data, server_cert, pairing_secret, expected_hash) ||
      CRYPTO_memcmp(expected_hash, challenge_response_data, hash_length) != 0) {
    ret = GS_FAILED; goto cleanup;
  }
  if (sign_it(client_secret_data, 16, &signature, &s_len, g_PrivateKey) != GS_OK || s_len != 256) {
    ret = GS_FAILED;
    goto cleanup;
  }

  unsigned char client_pairing_secret[16 + 256];
  char client_pairing_secret_hex[(16 + 256) * 2 + 1];
  memcpy(client_pairing_secret, client_secret_data, 16);
  memcpy(client_pairing_secret + 16, signature, 256);
  bytes_to_hex(client_pairing_secret, client_pairing_secret_hex, 16 + 256);

  snprintf(url, sizeof(url), "http://%s:%u/pair?uniqueid=%s&devicename=roth&updateState=1&clientpairingsecret=%s", host_for_url, sanitizedHttpPort, g_UniqueId, client_pairing_secret_hex);
  if ((ret = http_request(url, NULL, data)) != GS_OK)
    goto cleanup;

  free(result);
  result = NULL;
  if ((ret = xml_search(data->memory, data->size, "paired", &result)) != GS_OK)
    goto cleanup;

  if (strcmp(result, "1") != 0) {
    ret = GS_FAILED;
    goto cleanup;
  }

  *curl_ppk_string = x509_to_curl_ppk_string(server_cert);
  if (!*curl_ppk_string) ret = GS_OUT_OF_MEMORY;

  cleanup:
  OPENSSL_free(signature);
  if (ret != GS_OK)
    gs_unpair(address, sanitizedHttpPort);
  
  if (result != NULL)
    free(result);

  if (server_cert != NULL)
    X509_free(server_cert);

  http_free_data(data);

  return ret;
}
