'use strict';
// Exact approved settings/diagnostics delta. Unknown edits never normalize away.
const crypto=require('crypto'),cp=require('child_process');
const approved={
  "wasm/platform/menu-tools.js": "ff03639c0e1964adb06a4da86ddc18fed2a71dbd5cdbe6cc99132bffbbd857f5",
  "wasm/index.html": "def960a5b657d44d8eaf864613ef678a6d6d94697dde2826d7398b4060ea857b",
  "wasm/platform/index.js": "d1010ad16b7d57532f7b4fd52c422de42ebb54726063f74457fbbf3e93fe15ad",
  "wasm/platform/messages.js": "1b3da5b7ddd18893b09cbf6e669f8d92147cdd5381bb2a591faa9b1f4ed5f83e",
  "wasm/platform/navigation.js": "76c42dbecd3f9788ab960f7bd503487ed766ac3a75b041fc8081faf8786e9473",
  "wasm/platform/diagnostics.js": "bd7afe11923a5bb454837d3f51f211a91285ada1e2a37d1cb4d60f0ecf61cc40",
  "wasm/platform/stream-overlay.js": "67015b7daefc09e814f18f885c55e3316eb3c9af665cd0286494a7779b5a41a2",
  "wasm/platform/controller-mapping-menu.js": "6c964f258be9a924d41ee47e465623e1375b573b420532985b50d2adcc4789f1",
  "wasm/platform/console-library.js": "c1612ab23a88e0215b9572a653d2fc31c1f67ff88c396755d11a435472eb318b",
  "wasm/platform/menu-translations.js": "5bfb48ee3ded73e8a0afc0145fe22a15fb17d16e7c4bf82fa47e5c509ab19774",
  "wasm/platform/app-lifecycle.js": "99a02c0300ae940ff7deb3a04196a6aa7a0209a42bfd98ab0b8b5151fdb32573",
  "wasm/wasmplayer.cpp": "2e6b1125d03ae44934a4ea3d1d5ba12fed146b3ebdc8cc1eeae678bf92950443"
};
const added={
  "wasm/platform/menu-dialogs.js": "60cfb75bd3316fcbdbf8c82b8d6eed0e75f7f36818ae230143e5e20a41ce4ee0",
  "wasm/platform/diagnostic-history.js": "86f54cdd20f81c6426aa8be75e95462b02fe870670a3ee303bba11fed68e15f8",
  "wasm/platform/diagnostic-view.js": "ab69aba1f6e56d734dd01499b11ecfb4e5934ab428f8fc3fd433286753547200",
  "wasm/platform/stream-startup.js": "bc30cda293d3c510a1b431a7f60f2071631dc67df17f089ffb5aa7bd24b5fb74",
  "wasm/static/css/settings-experience.css": "e8a35552a2bfdbfa047f695e6a0c0d32eab3d65fc845dab8743630e644185f65"
};
function matches(file,source){return !!approved[file] && crypto.createHash('sha256').update(source).digest('hex')===approved[file];}
function normalize(file,source){return matches(file,source) ? cp.execFileSync('git',['cat-file','blob','b46c204:'+file],{encoding:'utf8'}) : source;}
function matchesAdded(file,source){return !!added[file] && crypto.createHash('sha256').update(source).digest('hex')===added[file];}
module.exports={matches,normalize,matchesAdded,added,files:Object.keys(approved)};
