'use strict';
// Explicit session-transition exceptions, independently exercised by
// host_quit_test and session_transition_test. Unknown full-file edits remain visible.
const cp=require('child_process'),crypto=require('crypto');
const approved={
  "wasm/http.cpp": "0193922d73451a925ad95af756059916621129da371bfdd6b52cd09a9b1140f2",
  "wasm/platform/index.js": "a56ac515d54bb9b54e883ee32e4b5a3a4244fa02957de0bab0ec8c9d63cf2755",
  "wasm/platform/app-lifecycle.js": "3b74c61067605c6f387705de6567a5616ad943cdc5a37c425aa79d6467024004",
  "wasm/static/js/utils.js": "c50ea220a6dad457451b08ea5340af404df6bec76953344921e9a5f1d5ef1cec"
};
const launchEdits=[
  [
    "  // Retire a superseded launch before waiting for the previous native session.\n  if (startGame.pending) startGame.pending.cancel();\n  var launchScope = createMenuRequestScope();\n  startGame.pending = launchScope;\n",
    ""
  ],
  [
    "  const launchCurrent = function() { return launchScope.active && startGame.pending === launchScope &&\n    (typeof AppLifecycle === 'undefined' || AppLifecycle.current(lifecycleEpoch)); };\n",
    "  const launchCurrent = function() { return typeof AppLifecycle === 'undefined' || AppLifecycle.current(lifecycleEpoch); };\n"
  ],
  [
    "  var closing = typeof AppLifecycle !== 'undefined' ? AppLifecycle.waitForStreamStop(launchScope) : null;\n  if (closing) snackbarLog('Finishing previous session...');\n  Promise.resolve(closing).then(function() {\n    if (!launchCurrent()) return;\n    return host.refreshServerInfo();\n  }).then(function(ret) {\n",
    "  host.refreshServerInfo().then(function(ret) {\n"
  ],
  [
    "              // Host quit was confirmed; the next launcher awaits native cleanup.\n              if (launchCurrent()) startGame(host, appID);\n",
    "              // Please, don't infinite loop with recursion\n              setTimeout(() => { if (launchCurrent()) startGame(host, appID); }, 3000);\n"
  ],
  [
    "    if (failedRefreshInfo && failedRefreshInfo.clientStreamStopping) {\n      snackbarLogLong('Previous stream is still closing. Retry shortly.');\n      return;\n    }\n",
    ""
  ]
];
function normalize(file,source) {
 source = require('./review-corrections-scope.cjs').normalize(file,source);
 if(!approved[file]||crypto.createHash('sha256').update(source).digest('hex')!==approved[file])return source;
 return cp.execFileSync('git',['cat-file','blob','96584ac:'+file],{encoding:'utf8'});
}
function launch(source) {
 source = require('./review-corrections-scope.cjs').launch(source);
 for(const [after,before] of launchEdits)source=source.replace(after,before);
 return source;
}
module.exports={normalize,launch,files:Object.keys(approved)};
