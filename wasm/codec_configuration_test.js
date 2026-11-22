'use strict';
// Compile the production setup method with a recording Samsung API adapter.
const fs=require('fs'),cp=require('child_process'),path=require('path'),assert=require('assert');
const source=fs.readFileSync('wasm/wasmplayer.cpp','utf8');
const begin=source.indexOf('int MoonlightInstance::StartupVidDecSetup('),end=source.indexOf('int MoonlightInstance::VidDecSetup(',begin);
assert(begin>=0&&end>begin);
const fixture=`
#include <string>
#include <vector>
#include <optional>
#include <atomic>
#include <condition_variable>
#include <functional>
#include <cassert>
#include <tuple>
#include "Limelight.h"
namespace samsung { namespace wasm {
 enum class OperationResult { kSuccess };
 enum class DecodingMode { kHardware };
 struct ElementaryVideoTrackConfig {std::string mime;std::vector<unsigned char> extra;DecodingMode mode;uint32_t width,height,num,den;};
 struct ElementaryVideoTrack {void SetListener(void*){}};
}}
using EmssOperationResult=samsung::wasm::OperationResult;
enum class EmssReadyState {kClosed,kOpenPending,kOpen};
struct Source {
 int rejects=0;std::vector<samsung::wasm::ElementaryVideoTrackConfig> attempts;
 std::optional<samsung::wasm::ElementaryVideoTrack> AddTrack(samsung::wasm::ElementaryVideoTrackConfig c) {
  attempts.push_back(c);if(rejects-->0)return {};return samsung::wasm::ElementaryVideoTrack{};
 }
 bool Open(std::function<void(EmssOperationResult)> cb){cb(EmssOperationResult::kSuccess);return true;}
};
struct Element {void SetSrc(Source*){};void Play(std::function<void(EmssOperationResult)> cb){cb(EmssOperationResult::kSuccess);}};
class MoonlightInstance {
public:
 std::shared_ptr<Source> m_Source=std::make_shared<Source>();
 Element m_MediaElement;std::atomic<bool> m_ConnectionCancelled{false},m_VideoStarted{true};
 EmssReadyState m_EmssReadyState=EmssReadyState::kClosed;
 std::condition_variable m_EmssStateChanged,m_EmssVideoStateChanged;
 std::shared_ptr<mlsession::CloseTicket> m_OpenTicket;
 samsung::wasm::ElementaryVideoTrack m_VideoTrack;std::unique_ptr<int> m_VideoTrackListener;bool waitResult=true;
 bool WaitFor(std::condition_variable*,std::function<bool()>){return waitResult;}
 int StartupVidDecSetup(int,int,int,int,void*,int);
};
MoonlightInstance* g_Instance;
void ClLogMessage(const char*,...){}
`;
const tests=`
int main(){
 for(int format : {VIDEO_FORMAT_H264,VIDEO_FORMAT_H265,VIDEO_FORMAT_H265_MAIN10,VIDEO_FORMAT_AV1_MAIN8,VIDEO_FORMAT_AV1_MAIN10})
 for(int width : {1920,2560,3840}) for(int fps : {30,60,120}) {
  MoonlightInstance app;g_Instance=&app;const int height=width==1920?1080:width==2560?1440:2160;
  assert(app.StartupVidDecSetup(format,width,height,fps,nullptr,0)==0);
  auto cfg=app.m_Source->attempts.front();assert(cfg.width==width&&cfg.height==height&&cfg.num==fps&&cfg.den==1);
  assert(cfg.mode==samsung::wasm::DecodingMode::kHardware&&cfg.extra.empty());
  const long long frameMbs=(long long)((width+15)/16)*((height+15)/16),mbRate=frameMbs*fps,sampleRate=(long long)width*height*fps;
  if(format==VIDEO_FORMAT_H264){
   // The level follows the picture and its macroblock rate (H.264 table A-1). 1440p up to 60 fps has always been 5.1 and
   // what level 4.2 can describe (8704 MBs, 522240 MB/s) has always been 4.2. Beyond that the level that covers it comes
   // first (5.1: 36864 MBs and 983040 MB/s, 5.2: 2073600 MB/s) with 4.2 behind it, and where no level covers it, 4.2 alone.
   const char* want=(width==2560&&fps<=60)?"avc1.640033":(frameMbs<=8704&&mbRate<=522240)?"avc1.64002A":
    (frameMbs<=36864&&mbRate<=983040)?"avc1.640033":mbRate<=2073600?"avc1.640034":"avc1.64002A";
   assert(cfg.mime.find(want)!=std::string::npos);
   const bool legacyOnly=(width==2560&&fps<=60)||want==std::string("avc1.64002A");
   assert(app.m_Source->attempts.size()==1);   // the first success ends the search
   (void)legacyOnly;
  }
  if(format==VIDEO_FORMAT_H265||format==VIDEO_FORMAT_H265_MAIN10){
   assert(cfg.mime.find(format==VIDEO_FORMAT_H265?"hev1.1.6.":"hev1.2.4.")!=std::string::npos);
   // Level 4.1 only below 1440p and up to 60 fps; level 5.2 only where 5.1's sample rate (534773760/s) is exceeded.
   const char* want=fps>60?(sampleRate>534773760?"L156":"L153"):(width==1920?"H123":"L153");
   assert(cfg.mime.find(want)!=std::string::npos);
  }
  if(format==VIDEO_FORMAT_AV1_MAIN8)assert(cfg.mime.find(fps>60&&sampleRate>534773760?"av01.0.14M.08":"av01.0.13M.08")!=std::string::npos);
  if(format==VIDEO_FORMAT_AV1_MAIN10)assert(cfg.mime.find(fps>60&&sampleRate>534773760?"av01.0.14M.10":"av01.0.13M.10")!=std::string::npos);
 }
 // Above 60 fps a refused level falls back to the declaration that has always been used, in order.
 {
  for(const auto& c : std::vector<std::tuple<int,int,int,const char*>>{{1920,1080,120,"avc1.640033"},{3840,2160,30,"avc1.640033"},{3840,2160,60,"avc1.640034"},{2560,1440,120,"avc1.640034"}}){
   MoonlightInstance a;g_Instance=&a;a.m_Source->rejects=1;
   assert(a.StartupVidDecSetup(VIDEO_FORMAT_H264,std::get<0>(c),std::get<1>(c),std::get<2>(c),nullptr,0)==0);
   assert(a.m_Source->attempts.size()==2&&a.m_Source->attempts[0].mime.find(std::get<3>(c))!=std::string::npos&&a.m_Source->attempts[1].mime.find("avc1.64002A")!=std::string::npos);
  }
  {   // where no level covers it (4K at 120 fps) or none is needed, there is one candidate: the one used until now
   MoonlightInstance a;g_Instance=&a;a.m_Source->rejects=100;
   assert(a.StartupVidDecSetup(VIDEO_FORMAT_H264,3840,2160,120,nullptr,0)==-1&&a.m_Source->attempts.size()==1);
   MoonlightInstance e;g_Instance=&e;e.m_Source->rejects=100;
   assert(e.StartupVidDecSetup(VIDEO_FORMAT_H264,1920,1080,60,nullptr,0)==-1&&e.m_Source->attempts.size()==1);
   MoonlightInstance f;g_Instance=&f;f.m_Source->rejects=100;
   assert(f.StartupVidDecSetup(VIDEO_FORMAT_H264,2560,1440,60,nullptr,0)==-1&&f.m_Source->attempts.size()==1);
  }
  MoonlightInstance b;g_Instance=&b;b.m_Source->rejects=1;
  assert(b.StartupVidDecSetup(VIDEO_FORMAT_H265,3840,2160,120,nullptr,0)==0);
  assert(b.m_Source->attempts.size()==2&&b.m_Source->attempts[0].mime.find("L156")!=std::string::npos&&b.m_Source->attempts[1].mime.find("L153")!=std::string::npos);
  MoonlightInstance c;g_Instance=&c;c.m_Source->rejects=1;
  assert(c.StartupVidDecSetup(VIDEO_FORMAT_AV1_MAIN8,3840,2160,120,nullptr,0)==0);
  assert(c.m_Source->attempts.size()==2&&c.m_Source->attempts[0].mime.find("av01.0.14M.08")!=std::string::npos&&c.m_Source->attempts[1].mime.find("av01.0.13M.08")!=std::string::npos);
  MoonlightInstance d;g_Instance=&d;d.m_Source->rejects=100;
  assert(d.StartupVidDecSetup(VIDEO_FORMAT_H264,1920,1080,120,nullptr,0)==-1);
 }
 // 30 and 60 fps keep exactly one candidate where they had one, and the same order where they had two.
 for(int fps : {30,60}){
  MoonlightInstance a;g_Instance=&a;
  assert(a.StartupVidDecSetup(VIDEO_FORMAT_H264,1920,1080,fps,nullptr,0)==0);assert(a.m_Source->attempts.size()==1);
  MoonlightInstance b;g_Instance=&b;b.m_Source->rejects=100;
  assert(b.StartupVidDecSetup(VIDEO_FORMAT_H265,1920,1080,fps,nullptr,0)==-1);assert(b.m_Source->attempts.size()==3);
 }
 MoonlightInstance app;g_Instance=&app;app.m_Source->rejects=1;
 assert(app.StartupVidDecSetup(VIDEO_FORMAT_H265,1920,1080,60,nullptr,0)==0);
 assert(app.m_Source->attempts.size()==2&&app.m_Source->attempts.back().mime.find("L123")!=std::string::npos);
 app.m_Source->rejects=100;
 assert(app.StartupVidDecSetup(VIDEO_FORMAT_H265,1920,1080,60,nullptr,0)==-1);
 assert(app.StartupVidDecSetup(0,1920,1080,60,nullptr,0)==-1);
 app.m_ConnectionCancelled=true;assert(app.StartupVidDecSetup(VIDEO_FORMAT_AV1_MAIN8,1920,1080,60,nullptr,0)==-1);
 app.m_ConnectionCancelled=false;app.waitResult=false;
 assert(app.StartupVidDecSetup(VIDEO_FORMAT_AV1_MAIN10,1920,1080,60,nullptr,0)==-1);
}
`;
const tmp=fs.mkdtempSync(path.join(require('os').tmpdir(),'moonlight-codec-test-'));
try {
 const file=path.join(tmp,'test.cpp'),bin=path.join(tmp,'test');
 fs.writeFileSync(file,'#include <memory>\n#include "session_lifecycle.hpp"\n'+fixture+source.slice(begin,end)+tests);
 cp.execFileSync('g++',['-std=c++17','-O1','-g','-pthread','-fsanitize=address,undefined','-fno-omit-frame-pointer','-Iwasm','-Imoonlight-common-c/src',file,'-o',bin],{stdio:'inherit'});
 cp.execFileSync(bin,[],{stdio:'inherit',timeout:5000});
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
console.log('codec_configuration_test: real H264/HEVC/AV1 setup matrix, HDR profiles, dimensions/FPS, fallback, rejection and cancellation OK');
