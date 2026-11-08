'use strict';
// Exact approved settings/diagnostics delta. Unknown edits never normalize away.
const crypto=require('crypto'),cp=require('child_process');
const approved={
  "wasm/index.html": "b478cccdf250653688f220ff79b98c33d38de0d5e4196449bbfa69169abe8df8",
  "wasm/platform/index.js": "8d9c9b29657bfcf41be0df37e654d5c1a439ba7aab5e7bb64c550962e04d4df0",
  "wasm/platform/messages.js": "249593b6c7be699c38031f812594b995c01b4d4eb5a5e6712024d827b10824f2",
  "wasm/platform/navigation.js": "9e456e3f72efb4b0f3fe43f9eee2d932668d9dfbc04a8d02af4405b387b39071",
  "wasm/platform/diagnostics.js": "bd7afe11923a5bb454837d3f51f211a91285ada1e2a37d1cb4d60f0ecf61cc40",
  "wasm/platform/stream-overlay.js": "67015b7daefc09e814f18f885c55e3316eb3c9af665cd0286494a7779b5a41a2",
  "wasm/platform/controller-mapping-menu.js": "6c964f258be9a924d41ee47e465623e1375b573b420532985b50d2adcc4789f1",
  "wasm/platform/console-library.js": "2e7773103d9d6fc790b3c62a0f3f498f0d69cc0f158faf2e4c1fd7bc45cb5387",
  "wasm/platform/menu-translations.js": "f5e16c834fa2ade2752b88e64702c970dcef13cebff0d558cad41e9862cb6032",
  "wasm/platform/app-lifecycle.js": "99a02c0300ae940ff7deb3a04196a6aa7a0209a42bfd98ab0b8b5151fdb32573",
  "wasm/wasmplayer.cpp": "2e6b1125d03ae44934a4ea3d1d5ba12fed146b3ebdc8cc1eeae678bf92950443"
};
const added={
  "wasm/platform/diagnostic-history.js": "c41f3cdc16907791398961385dde7a0527d23cd65c1f90922e55817e686d4d3f",
  "wasm/platform/diagnostic-view.js": "c54d475c35315702b81370dda87a9d755d6b996feee067e45495d68f0363b836",
  "wasm/platform/stream-startup.js": "8bc7d63bceed5bd097e79aa81b908405704dfcd2c8ba09befe3bafbc57a504e2",
  "wasm/static/css/settings-experience.css": "76711643d27f9f5ea4e3e936a490bb18e1953636cf0fa53af472c861be7bf65a"
};
function matches(file,source){return !!approved[file] && crypto.createHash('sha256').update(source).digest('hex')===approved[file];}
function normalize(file,source){return matches(file,source) ? cp.execFileSync('git',['cat-file','blob','b46c204:'+file],{encoding:'utf8'}) : source;}
function matchesAdded(file,source){return !!added[file] && crypto.createHash('sha256').update(source).digest('hex')===added[file];}
module.exports={matches,normalize,matchesAdded,added,files:Object.keys(approved)};
