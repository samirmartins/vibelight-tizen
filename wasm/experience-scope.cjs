'use strict';
// Exact approved settings/diagnostics delta. Unknown edits never normalize away.
const crypto=require('crypto'),cp=require('child_process');
const approved={
  "wasm/platform/menu-tools.js": "ff03639c0e1964adb06a4da86ddc18fed2a71dbd5cdbe6cc99132bffbbd857f5",
  "wasm/index.html": "4efd9f9e8697455a5a9ccea2074724f8e6cd6fbc9ef0839f0af180e3fa6e32cd",
  "wasm/platform/index.js": "c10b64ad918fd4cffcb81e0e473e47b166bf2fe24fa4c265f67875897b9ded4d",
  "wasm/platform/messages.js": "1b3da5b7ddd18893b09cbf6e669f8d92147cdd5381bb2a591faa9b1f4ed5f83e",
  "wasm/platform/navigation.js": "76c42dbecd3f9788ab960f7bd503487ed766ac3a75b041fc8081faf8786e9473",
  "wasm/platform/diagnostics.js": "bd7afe11923a5bb454837d3f51f211a91285ada1e2a37d1cb4d60f0ecf61cc40",
  "wasm/platform/stream-overlay.js": "67015b7daefc09e814f18f885c55e3316eb3c9af665cd0286494a7779b5a41a2",
  "wasm/platform/controller-mapping-menu.js": "6c964f258be9a924d41ee47e465623e1375b573b420532985b50d2adcc4789f1",
  "wasm/platform/console-library.js": "c1612ab23a88e0215b9572a653d2fc31c1f67ff88c396755d11a435472eb318b",
  "wasm/platform/menu-translations.js": "ec8cf35c176834bbc184452bab21b24d388221292215bd6a6557835d8240e89d",
  "wasm/platform/app-lifecycle.js": "99a02c0300ae940ff7deb3a04196a6aa7a0209a42bfd98ab0b8b5151fdb32573",
  "wasm/wasmplayer.cpp": "2e6b1125d03ae44934a4ea3d1d5ba12fed146b3ebdc8cc1eeae678bf92950443"
};
const added={
  "wasm/static/res/guide-qr.svg": "045d4f42cc7156dbc75259fc4d6db2a585effaab864c0b52269525cf2f5339fd",
  "wasm/platform/guide-help.js": "607da9a2368d0b05b0ad54adcdd9d9d0f12230bbcc5e504bd3952d360ff92a14",
  "wasm/platform/menu-dialogs.js": "60cfb75bd3316fcbdbf8c82b8d6eed0e75f7f36818ae230143e5e20a41ce4ee0",
  "wasm/platform/diagnostic-history.js": "86f54cdd20f81c6426aa8be75e95462b02fe870670a3ee303bba11fed68e15f8",
  "wasm/platform/diagnostic-view.js": "ab69aba1f6e56d734dd01499b11ecfb4e5934ab428f8fc3fd433286753547200",
  "wasm/platform/stream-startup.js": "bc30cda293d3c510a1b431a7f60f2071631dc67df17f089ffb5aa7bd24b5fb74",
  "wasm/static/css/settings-experience.css": "3730cd28fb13d9ef50e7719f75177e354539a97749e5627fca955f0c70e18875"
};
function matches(file,source){return !!approved[file] && crypto.createHash('sha256').update(source).digest('hex')===approved[file];}
function normalize(file,source){return matches(file,source) ? cp.execFileSync('git',['cat-file','blob','b46c204:'+file],{encoding:'utf8'}) : source;}
function matchesAdded(file,source){return !!added[file] && crypto.createHash('sha256').update(source).digest('hex')===added[file];}
module.exports={matches,normalize,matchesAdded,added,files:Object.keys(approved)};
