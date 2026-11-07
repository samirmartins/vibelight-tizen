'use strict';
// Compile the real feeder/init/cleanup with deterministic Opus and JS adapters.
const fs=require('fs'),cp=require('child_process'),path=require('path'),os=require('os');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'audio-cleanup-'));
try {
 fs.writeFileSync(path.join(dir,'moonlight_wasm.hpp'),`
#pragma once
#include <atomic>
#include <cstdint>
#include <cstring>
#include <cassert>
struct OpusConfig {int channelCount,samplesPerFrame,sampleRate,streams,coupledStreams;unsigned char* mapping;};
using POPUS_MULTISTREAM_CONFIGURATION=OpusConfig*;
struct MoonlightInstance {
 int m_AudioJitterMs=100;std::atomic<bool> m_AudioQuiescent{true};std::atomic<uint32_t> m_SessionGeneration{1};
 static void ClLogMessage(const char*,...){}
 static int AudDecInit(int,POPUS_MULTISTREAM_CONFIGURATION,void*,int);
 static void AudDecCleanup();static void AudDecDecodeAndPlaySample(char*,int);
};
extern MoonlightInstance* g_Instance;
static std::atomic<uint32_t> fakeClock{0},faults{0};
static uint32_t LiGetMillis(){return fakeClock;}
static void PostToJs(const char*){faults++;}
static void Bridge(const char* text){if(strstr(text,"recovery timed out"))faults++;}
`);
 fs.writeFileSync(path.join(dir,'opus_multistream.h'),`
#pragma once
#include <cstdint>
#include <cstring>
using opus_int16=int16_t;
struct OpusMSDecoder{};
static OpusMSDecoder* opus_multistream_decoder_create(int,int,int,int,unsigned char*,int* rc){*rc=0;return new OpusMSDecoder;}
static void opus_multistream_decoder_destroy(OpusMSDecoder* d){delete d;}
static int opus_multistream_decode(OpusMSDecoder*,const unsigned char*,int,opus_int16* out,int frames,int){memset(out,0,frames*sizeof(*out));return frames;}
`);
 fs.writeFileSync(path.join(dir,'emscripten.h'),'#define MAIN_THREAD_ASYNC_EM_ASM(...) Bridge(#__VA_ARGS__)\n');
 const source=fs.readFileSync('wasm/auddec.cpp','utf8').split('\nAUDIO_RENDERER_CALLBACKS')[0].replace('#include "moonlight_wasm.hpp"','#include <moonlight_wasm.hpp>').replace('#include "audio_ring.hpp"','#include <audio_ring.hpp>');
 fs.writeFileSync(path.join(dir,'test.cpp'),source+`
MoonlightInstance app;MoonlightInstance* g_Instance=&app;
int main(){
 OpusConfig config{1,480,48000,1,0,nullptr};
 for(int i=0;i<20;i++){
  assert(MoonlightInstance::AudDecInit(0,&config,nullptr,0)==0);
  std::this_thread::sleep_for(std::chrono::milliseconds(1));
  MoonlightInstance::AudDecCleanup();assert(app.m_AudioQuiescent&&!s_OpusDecoder);
 }
 assert(MoonlightInstance::AudDecInit(0,&config,nullptr,0)==0);
 for(unsigned owner : {1u,2u,8u}){
  s_pcmRing.control()->consumerGate.store(owner);
  std::thread consumer([owner]{std::this_thread::sleep_for(std::chrono::milliseconds(5));s_pcmRing.control()->consumerGate.fetch_and(~owner);});
  MoonlightInstance::AudDecCleanup();consumer.join();assert(app.m_AudioQuiescent);
  assert(MoonlightInstance::AudDecInit(0,&config,nullptr,0)==0);
 }
 MoonlightInstance::AudDecCleanup();
 assert(MoonlightInstance::AudDecInit(0,&config,nullptr,0)==0);
 s_pcmRing.control()->consumerGate.store(2);
 auto* retained=s_OpusDecoder;MoonlightInstance::AudDecCleanup();
 assert(!app.m_AudioQuiescent&&s_OpusDecoder==retained&&faults==1);
 assert(MoonlightInstance::AudDecInit(0,&config,nullptr,0)==-1);
 s_pcmRing.control()->consumerGate.fetch_and(~3u);
 MoonlightInstance::AudDecCleanup();assert(app.m_AudioQuiescent&&!s_OpusDecoder);
}
`);
 const binary=path.join(dir,'test');
 cp.execFileSync('g++',['-std=c++17','-pthread','-O1','-g','-fsanitize='+(process.env.ML_NATIVE_SANITIZERS||'address,undefined'),'-I'+dir,'-Iwasm',path.join(dir,'test.cpp'),'-o',binary],{stdio:'inherit'});
 cp.execFileSync('timeout',['10s',binary],{stdio:'inherit'});
 console.log('audio_cleanup_test: production idle stop, callback retirement, bounded timeout, retained resources and blocked reinitialization OK');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
