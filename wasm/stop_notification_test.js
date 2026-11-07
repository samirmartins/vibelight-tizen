'use strict';
const fs=require('fs'),cp=require('child_process'),path=require('path'),os=require('os');
const audio=fs.readFileSync('wasm/auddec.cpp','utf8');
const predicate=audio.slice(audio.indexOf('s_pktCv.wait(lock'),audio.indexOf('s_pktCv.wait(lock')+250).split('});')[0]+'});';
const cleanup=audio.slice(audio.indexOf('if (s_feederThread.joinable()) {'),audio.indexOf('    s_feederThread.join();'));
const stop=cleanup.slice(cleanup.indexOf('{')+1).replaceAll('std::mutex>','TrackedMutex>');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stop-notification-'));
try {
 fs.writeFileSync(path.join(dir,'test.cpp'),`
#include <atomic>
#include <mutex>
#include <condition_variable>
#include <thread>
#include <chrono>
#include <cassert>
thread_local bool stopper=false;
std::atomic<bool> checked{false},releasePredicate{false},attempt{false},finished{false};
struct TrackedMutex {std::mutex mutex;void lock(){if(stopper)attempt=true;mutex.lock();}void unlock(){mutex.unlock();}};
struct Running {
 std::atomic<bool> value{true};
 bool load(std::memory_order o){bool v=value.load(o);if(!stopper&&v&&!checked.exchange(true))while(!releasePredicate)std::this_thread::yield();return v;}
 void store(bool v,std::memory_order o){value.store(v,o);if(stopper)attempt=true;}
} s_feederRunning;
TrackedMutex s_pktMutex;std::condition_variable_any s_pktCv;int s_pktCount=0;
int main(){
 std::thread feeder([]{std::unique_lock<TrackedMutex> lock(s_pktMutex);${predicate}finished=true;});
 while(!checked)std::this_thread::yield();
 std::thread stop([]{stopper=true;${stop}});
 while(!attempt)std::this_thread::yield();
 // A locked stop cannot publish until the predicate enters its atomic wait.
 if(s_feederRunning.value.load())releasePredicate=true;
 else {stop.join();releasePredicate=true;}
 if(stop.joinable())stop.join();
 auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(1);
 while(!finished&&std::chrono::steady_clock::now()<deadline)std::this_thread::yield();
 bool passed=finished;
 {std::lock_guard<TrackedMutex> rescue(s_pktMutex);s_pktCv.notify_all();}
 feeder.join();assert(passed && "stop notification was lost");
}`);
 const bin=path.join(dir,'test');cp.execFileSync('g++',['-std=c++17','-O1','-pthread',path.join(dir,'test.cpp'),'-o',bin],{stdio:'inherit'});
 cp.execFileSync('timeout',['5s',bin],{stdio:'inherit'});
 console.log('stop_notification_test: production predicate and stop publish under a forced interleaving OK');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
