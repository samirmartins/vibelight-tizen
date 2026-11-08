'use strict';
// Exact approved settings/diagnostics delta. Unknown edits never normalize away.
const crypto=require('crypto'),cp=require('child_process');
const approved={
  "wasm/index.html": "73a795bf17527f2a2537cc875ec1c9dfd5cff9847823dfa796767891bf722e91",
  "wasm/platform/index.js": "a58ead68c276a5eb1ae9adb826fc557146c38a0734491bd043cedb875a3a9802",
  "wasm/platform/messages.js": "1b3da5b7ddd18893b09cbf6e669f8d92147cdd5381bb2a591faa9b1f4ed5f83e",
  "wasm/platform/navigation.js": "e27505a89d175c5a366695d074a7d929e7da256a4b1171ebbef83914b9b3cf00",
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
  "wasm/platform/stream-startup.js": "18446e5729afb82ba72f1bd8cf4f3656a988740e5f5eae4caecc714abcbffa97",
  "wasm/static/css/settings-experience.css": "78f019b3903be40e8a051f4c96ddd635cefa8e62d8172dfdc0bd0b768f0760c4"
};
function matches(file,source){return !!approved[file] && crypto.createHash('sha256').update(source).digest('hex')===approved[file];}
function normalize(file,source){return matches(file,source) ? cp.execFileSync('git',['cat-file','blob','b46c204:'+file],{encoding:'utf8'}) : source;}
function matchesAdded(file,source){return !!added[file] && crypto.createHash('sha256').update(source).digest('hex')===added[file];}
module.exports={matches,normalize,matchesAdded,added,files:Object.keys(approved)};
