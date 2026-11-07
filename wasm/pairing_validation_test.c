// Local synthetic peer: exercises the production parser and pairing handshake.
#include <stdlib.h>
static int allocation_count, fail_allocation;
static void* checked_malloc(size_t size) {
  if (++allocation_count == fail_allocation) return NULL;
  return malloc(size);
}
#define malloc checked_malloc
#include "../libgamestream/pairing.c"
#undef malloc
#include <assert.h>

X509 *g_Cert;
EVP_PKEY *g_PrivateKey;
char *g_UniqueId = "fixture-client";
char *g_CertHex = "00";
static X509 *peer;
static EVP_PKEY *peer_key;
static AES_KEY peer_enc, peer_dec;
static unsigned char secret[16] = {7};
static int version, invalid, step, unpaired;

PHTTP_DATA http_create_data(void) {
  PHTTP_DATA d = calloc(1, sizeof(*d));
  d->memory = calloc(1, 1);
  return d;
}
void http_free_data(PHTTP_DATA d) { free(d->memory); free(d); }
static void reply(PHTTP_DATA d, const char *tag, const char *value) {
  free(d->memory);
  d->memory = malloc(strlen(tag)*2 + strlen(value) + 100);
  sprintf(d->memory, "<root><paired>1</paired><%s>%s</%s></root>", tag, value, tag);
  d->size = strlen(d->memory);
}
static void decode(const char *hex, unsigned char *out, size_t n) {
  for (size_t i = 0; i < n; i++) assert(sscanf(hex+2*i, "%2hhx", out+i) == 1);
}
int http_request(const char *url, const char *pin, PHTTP_DATA d) {
  (void)pin;
  if (strstr(url, "/unpair?")) { unpaired++; return GS_OK; }
  step++;
  if (step == 1) {
    unsigned char salted[20], hash[32];
    decode(strstr(url, "&salt=")+6, salted, 16);
    memcpy(salted+16, "1234", 4);
    if (version >= 7) SHA256(salted, 20, hash); else SHA1(salted, 20, hash);
    AES_set_encrypt_key(hash, 128, &peer_enc);
    AES_set_decrypt_key(hash, 128, &peer_dec);
    BIO *bio = BIO_new(BIO_s_mem());
    PEM_write_bio_X509(bio, peer);
    BUF_MEM *mem; BIO_get_mem_ptr(bio, &mem);
    char *hex = malloc(mem->length*2+1);
    bytes_to_hex((unsigned char*)mem->data, hex, mem->length);
    reply(d, "plaincert", invalid == 2 ? "abc" : hex);
    free(hex); BIO_free(bio);
  } else if (step == 2) {
    unsigned char encrypted[16], challenge[16], response[48] = {0}, output[48];
    decode(strstr(url, "&clientchallenge=")+17, encrypted, 16);
    AES_decrypt(encrypted, challenge, &peer_dec);
    const ASN1_BIT_STRING *sig; X509_get0_signature(&sig, NULL, peer);
    size_t n = 16 + sig->length + 16;
    unsigned char *input = malloc(n);
    memcpy(input, challenge, 16); memcpy(input+16, sig->data, sig->length);
    memcpy(input+16+sig->length, secret, 16);
    if (version >= 7) SHA256(input, n, response); else SHA1(input, n, response);
    free(input);
    if (invalid == 1) response[0] ^= 1;
    memset(response+(version >= 7 ? 32 : 20), 8, 16);
    for (int i=0;i<48;i+=16) AES_encrypt(response+i, output+i, &peer_enc);
    char hex[97]; bytes_to_hex(output, hex, 48);
    reply(d, "challengeresponse", invalid == 3 ? "00" : invalid == 4 ? "zz" : hex);
  } else if (step == 3) {
    unsigned char *sig = NULL, payload[272]; size_t n;
    assert(sign_it(secret, 16, &sig, &n, peer_key) == GS_OK && n == 256);
    memcpy(payload, secret, 16); memcpy(payload+16, sig, n); OPENSSL_free(sig);
    if (invalid == 5) payload[20] ^= 1;
    char hex[545]; bytes_to_hex(payload, hex, sizeof(payload));
    reply(d, "pairingsecret", invalid == 6 ? "00" : hex);
  } else {
    assert(step == 4 && strstr(url, "&clientpairingsecret="));
    unsigned char payload[272]; decode(strstr(url,"&clientpairingsecret=")+21,payload,272);
    assert(verifySignature(payload,16,payload+16,256,g_Cert));
    reply(d, "done", "1");
  }
  return GS_OK;
}
static EVP_PKEY *make_key(void) {
  EVP_PKEY_CTX *ctx=EVP_PKEY_CTX_new_id(EVP_PKEY_RSA,NULL); EVP_PKEY *key=NULL;
  assert(ctx && EVP_PKEY_keygen_init(ctx)>0 && EVP_PKEY_CTX_set_rsa_keygen_bits(ctx,2048)>0);
  assert(EVP_PKEY_keygen(ctx,&key)>0); EVP_PKEY_CTX_free(ctx); return key;
}
static X509 *make_cert(EVP_PKEY *key) {
  X509 *cert=X509_new(); assert(cert);
  X509_set_version(cert,2); ASN1_INTEGER_set(X509_get_serialNumber(cert),1);
  X509_gmtime_adj(X509_get_notBefore(cert),0); X509_gmtime_adj(X509_get_notAfter(cert),3600);
  assert(X509_set_pubkey(cert,key));
  X509_NAME *name=X509_get_subject_name(cert);
  X509_NAME_add_entry_by_txt(name,"CN",MBSTRING_ASC,(unsigned char*)"fixture.invalid",-1,-1,0);
  X509_set_issuer_name(cert,name); assert(X509_sign(cert,key,EVP_sha256())); return cert;
}
int main(int argc, char** argv) {
  (void)argv;
  char *out=NULL;
  // The supplied length is authoritative; no trailing NUL is required.
  char bounded[]={'<','x','>','1','<','/','x','>','X',0};
  if (argc == 1) {
  assert(xml_search(bounded,8,"x",&out)==GS_OK && !strcmp(out,"1")); free(out);
  for (const char **p=(const char*[]){"", "</x><x>1", "<x>1", "<x>1</x><x>2</x>",NULL};*p;p++) {
    out=NULL; assert(xml_search((char*)*p,strlen(*p),"x",&out)!=GS_OK && !out);
  }
  }
  g_PrivateKey=make_key(); g_Cert=make_cert(g_PrivateKey);
  peer_key=make_key(); peer=make_cert(peer_key);
  for (version=6;version<=7;version++) for (invalid=0;invalid<=6;invalid++) {
    step=unpaired=0; char *pin=NULL;
    int result=gs_pair(version,"fixture.invalid",47989,"1234",&pin);
    if (!invalid) { assert(result==GS_OK && pin && !strncmp(pin,"sha256//",8) && step==4 && !unpaired); free(pin); }
    else assert(result!=GS_OK && !pin && unpaired==1 && step<4);
  }
  version=7;invalid=0;
  for (fail_allocation=1;fail_allocation<=20;fail_allocation++) {
    allocation_count=step=unpaired=0;char *pin=NULL;
    int result=gs_pair(version,"fixture.invalid",47989,"1234",&pin);
    if(result==GS_OK){assert(pin);free(pin);}else assert(!pin && unpaired==1);
  }
  fail_allocation=0;
  unsigned char *sig=NULL;size_t length=0;
  assert(sign_it(secret,16,&sig,&length,NULL)!=GS_OK && !sig && !length);
  X509_free(peer); EVP_PKEY_free(peer_key); X509_free(g_Cert); EVP_PKEY_free(g_PrivateKey);
  puts("pairing_validation_test: bounded XML, malformed hex, SHA1/SHA256 handshake, challenge authentication and cleanup OK");
}
