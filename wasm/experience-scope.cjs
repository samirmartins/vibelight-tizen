'use strict';
// Exact approved settings/diagnostics delta. Unknown edits never normalize away.
const crypto=require('crypto'),cp=require('child_process');
const approved={
  "wasm/index.html": "73a795bf17527f2a2537cc875ec1c9dfd5cff9847823dfa796767891bf722e91",
  "wasm/platform/index.js": "0a5d8dbf46b59814a448ab900005e06ca67f9fda22127426afb2b4b2ac1c1ef0",
  "wasm/platform/messages.js": "249593b6c7be699c38031f812594b995c01b4d4eb5a5e6712024d827b10824f2",
  "wasm/platform/navigation.js": "85be5cd7b3d238a96b361c9bfab74187c37b8ff70939e9ebbef1fb1369bc9695",
  "wasm/platform/diagnostics.js": "bd7afe11923a5bb454837d3f51f211a91285ada1e2a37d1cb4d60f0ecf61cc40",
  "wasm/platform/stream-overlay.js": "67015b7daefc09e814f18f885c55e3316eb3c9af665cd0286494a7779b5a41a2",
  "wasm/platform/controller-mapping-menu.js": "6c964f258be9a924d41ee47e465623e1375b573b420532985b50d2adcc4789f1",
  "wasm/platform/console-library.js": "2e7773103d9d6fc790b3c62a0f3f498f0d69cc0f158faf2e4c1fd7bc45cb5387",
  "wasm/platform/menu-translations.js": "873919b87acd90ce5cf7dfe8ec19253221693993f664be3d3a492c57f5d6edd4",
  "wasm/platform/app-lifecycle.js": "99a02c0300ae940ff7deb3a04196a6aa7a0209a42bfd98ab0b8b5151fdb32573",
  "wasm/wasmplayer.cpp": "2e6b1125d03ae44934a4ea3d1d5ba12fed146b3ebdc8cc1eeae678bf92950443"
};
const added={
  "wasm/platform/diagnostic-history.js": "c41f3cdc16907791398961385dde7a0527d23cd65c1f90922e55817e686d4d3f",
  "wasm/platform/diagnostic-view.js": "c54d475c35315702b81370dda87a9d755d6b996feee067e45495d68f0363b836",
  "wasm/platform/stream-startup.js": "8bc7d63bceed5bd097e79aa81b908405704dfcd2c8ba09befe3bafbc57a504e2",
  "wasm/static/css/settings-experience.css": "9c0f5bd5b8ce6fc72abb489d7eb83a0464fd71db1b5b47c2ea15fe2c9ce0d240"
};
function matches(file,source){return !!approved[file] && crypto.createHash('sha256').update(source).digest('hex')===approved[file];}
function normalize(file,source){return matches(file,source) ? cp.execFileSync('git',['cat-file','blob','b46c204:'+file],{encoding:'utf8'}) : source;}
function matchesAdded(file,source){return !!added[file] && crypto.createHash('sha256').update(source).digest('hex')===added[file];}
module.exports={matches,normalize,matchesAdded,added,files:Object.keys(approved)};
