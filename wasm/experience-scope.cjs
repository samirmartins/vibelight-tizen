'use strict';
// Exact approved settings/diagnostics delta. Unknown edits never normalize away.
const crypto=require('crypto'),cp=require('child_process');
const approved={
  "wasm/index.html": "b478cccdf250653688f220ff79b98c33d38de0d5e4196449bbfa69169abe8df8",
  "wasm/platform/index.js": "3d5670408c9fe2caab608975e65ed0ffcad2e254ca38ecdc9ef3b10878400233",
  "wasm/platform/messages.js": "249593b6c7be699c38031f812594b995c01b4d4eb5a5e6712024d827b10824f2",
  "wasm/platform/navigation.js": "9e456e3f72efb4b0f3fe43f9eee2d932668d9dfbc04a8d02af4405b387b39071",
  "wasm/platform/diagnostics.js": "8d77472304036f86ff39382b2dcd5dcf16e572b1f81f0991c98febf2e39b3a00",
  "wasm/platform/stream-overlay.js": "67015b7daefc09e814f18f885c55e3316eb3c9af665cd0286494a7779b5a41a2",
  "wasm/platform/controller-mapping-menu.js": "6c964f258be9a924d41ee47e465623e1375b573b420532985b50d2adcc4789f1",
  "wasm/platform/console-library.js": "2e7773103d9d6fc790b3c62a0f3f498f0d69cc0f158faf2e4c1fd7bc45cb5387",
  "wasm/platform/menu-translations.js": "a25f9332ba83627749c5361fe5e40ff31c70c4d08eeba8aff6acedc562208e8d",
  "wasm/platform/app-lifecycle.js": "99a02c0300ae940ff7deb3a04196a6aa7a0209a42bfd98ab0b8b5151fdb32573",
  "wasm/wasmplayer.cpp": "2e6b1125d03ae44934a4ea3d1d5ba12fed146b3ebdc8cc1eeae678bf92950443"
};
const added={
  "wasm/platform/diagnostic-history.js": "3d3c0b82eb01dcc0a21d718f98004639a428caa3fe9a396beedd4cc0e95930eb",
  "wasm/platform/diagnostic-view.js": "6ca973d37b60835389fa371b3fb68d4867e078226faa5e664a0ece37a346041e",
  "wasm/platform/stream-startup.js": "8bc7d63bceed5bd097e79aa81b908405704dfcd2c8ba09befe3bafbc57a504e2",
  "wasm/static/css/settings-experience.css": "76711643d27f9f5ea4e3e936a490bb18e1953636cf0fa53af472c861be7bf65a"
};
function matches(file,source){return !!approved[file] && crypto.createHash('sha256').update(source).digest('hex')===approved[file];}
function normalize(file,source){return matches(file,source) ? cp.execFileSync('git',['cat-file','blob','b46c204:'+file],{encoding:'utf8'}) : source;}
function matchesAdded(file,source){return !!added[file] && crypto.createHash('sha256').update(source).digest('hex')===added[file];}
module.exports={matches,normalize,matchesAdded,added,files:Object.keys(approved)};
