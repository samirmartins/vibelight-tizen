'use strict';
// Reverse only the exact reviewed menu localization integration.
const edits = [
  [
    "wasm/index.html",
    "  <link rel=\"stylesheet\" href=\"static/css/menu-i18n.css\">\n",
    ""
  ],
  [
    "wasm/index.html",
    "          <div id=\"languageControl\">\n            <button type=\"button\" id=\"languageBtn\" class=\"console-toolbar-button\" aria-label=\"Language / Idioma\" aria-haspopup=\"menu\" aria-expanded=\"false\" aria-controls=\"languageMenu\">\n              <img id=\"languageFlag\" src=\"static/res/flags/us.svg\" alt=\"\"><span id=\"languageName\">English</span><span aria-hidden=\"true\">▾</span>\n            </button>\n            <div id=\"languageMenu\" role=\"menu\" aria-label=\"Language / Idioma\" hidden>\n              <button type=\"button\" id=\"language-en\" role=\"menuitemradio\" aria-checked=\"true\" lang=\"en\"><img src=\"static/res/flags/us.svg\" alt=\"\">English<span class=\"language-check\" aria-hidden=\"true\">✓</span></button>\n              <button type=\"button\" id=\"language-pt-BR\" role=\"menuitemradio\" aria-checked=\"false\" lang=\"pt-BR\"><img src=\"static/res/flags/br.svg\" alt=\"\">Português (Brasil)<span class=\"language-check\" aria-hidden=\"true\">✓</span></button>\n              <button type=\"button\" id=\"language-es\" role=\"menuitemradio\" aria-checked=\"false\" lang=\"es\"><img src=\"static/res/flags/es.svg\" alt=\"\">Español<span class=\"language-check\" aria-hidden=\"true\">✓</span></button>\n            </div>\n          </div>\n",
    ""
  ],
  [
    "wasm/index.html",
    "  <script type=\"text/javascript\" src=\"platform/menu-translations.js\"></script>\n  <script type=\"text/javascript\" src=\"platform/menu-i18n.js\"></script>\n",
    ""
  ],
  [
    "wasm/platform/navigation.js",
    "    view: new ListView(() => document.getElementById('libraryHomeBtn').style.display === 'none' ? ['languageBtn','settingsBtn'] : ['libraryHomeBtn','languageBtn','settingsBtn']),\n",
    "    view: new ListView(() => document.getElementById('libraryHomeBtn').style.display === 'none' ? ['settingsBtn'] : ['libraryHomeBtn','settingsBtn']),\n"
  ],
  [
    "wasm/platform/navigation.js",
    "      'languageBtn',\n",
    ""
  ],
  [
    "wasm/platform/navigation.js",
    "      if (typeof MenuI18n !== 'undefined') MenuI18n.start();\n",
    ""
  ],
  [
    "wasm/platform/navigation.js",
    "      if (typeof MenuI18n !== 'undefined') MenuI18n.stop();\n",
    ""
  ],
  [
    "wasm/platform/console-library.js",
    "    return ['libraryPCsBtn','languageBtn','settingsBtn','quitRunningAppBtn','libraryWake','libraryPlay','libraryFavorite','libraryAll','libraryFavorites','libraryRecent','libraryRefresh'].filter(function(name) {\n",
    "    return ['libraryPCsBtn','settingsBtn','quitRunningAppBtn','libraryWake','libraryPlay','libraryFavorite','libraryAll','libraryFavorites','libraryRecent','libraryRefresh'].filter(function(name) {\n"
  ],
  [
    "wasm/platform/console-library.js",
    "  function focusNav(step, control) {\n",
    "  function focusNav(step) {\n"
  ],
  [
    "wasm/platform/console-library.js",
    "    if (control && names.indexOf(control) !== -1) navIndex = names.indexOf(control);\n",
    ""
  ],
  [
    "wasm/platform/console-library.js",
    "    el('libraryTitle').setAttribute('data-i18n-skip', String(!!app));\n",
    ""
  ],
  [
    "res/config.xml",
    "<widget xmlns:tizen=\"http://tizen.org/ns/widgets\" xmlns=\"http://www.w3.org/ns/widgets\" id=\"http://samsung.tv/MoonlightWasm\" version=\"4.0.0\" viewmodes=\"fullscreen\">\n",
    "<widget xmlns:tizen=\"http://tizen.org/ns/widgets\" xmlns=\"http://www.w3.org/ns/widgets\" id=\"http://samsung.tv/MoonlightWasm\" version=\"3.4.15\" viewmodes=\"fullscreen\">\n"
  ],
  ["wasm/platform/messages.js", "    var progress = msg.replace('ProgressMsg: ', '');\n    $('#loadingSpinnerMessage').text(typeof MenuI18n !== 'undefined' ? (MenuI18n.progressText[progress] || progress) : progress);\n", "    $('#loadingSpinnerMessage').text(msg.replace('ProgressMsg: ', ''));\n"],
  ["wasm/platform/messages.js", "    warningDialog('Warning', msg.replace('DialogMsg: ', ''));\n    if (typeof MenuI18n !== 'undefined' && document.getElementById('loadingSpinner').style.display !== 'none') MenuI18n.connectionDialog();\n", "    warningDialog('Warning', msg.replace('DialogMsg: ', ''));\n"]
];
function normalize(file,source) {
  for (const [target,after,before] of edits) if (target===file) source=source.replace(after,before);
  return source;
}
module.exports={normalize};
