'use strict';
// Exact menu-only interface settings delta. Historical contracts see the
// approved pre-settings source; unknown neighboring edits remain visible.
function normalize(file, source) {
  source=require('./experience-scope.cjs').normalize(file,source);
  if (file === 'wasm/index.html') {
    return source
      .replace('  <script type="text/javascript" src="platform/interface-sounds.js"></script>\n', '')
      .replace('            <div class="setting-option">\n' +
        '              <label>Interface sounds</label>\n' +
        '              <span class="mdl-list__item-text-body">\n' +
        '                - Short navigation tones for menus. They stop before streaming starts.\n' +
        '              </span>\n' +
        '              <div id="interfaceSoundsMenu">\n' +
        '                <label id="interfaceSoundsBtn" class="mdl-switch mdl-js-switch mdl-js-ripple-effect" for="interfaceSoundsSwitch">\n' +
        '                  <input type="checkbox" id="interfaceSoundsSwitch" class="mdl-switch__input">\n' +
        '                  <span class="mdl-switch__label">Play navigation sounds in menus</span>\n' +
        '                </label>\n' +
        '              </div>\n' +
        '            </div>\n', '');
  }
  if (file === 'wasm/static/css/style.css') {
    return source
      .replace('#selectAudio, #playHostAudioBtn, #interfaceSoundsBtn,\n' +
        '#selectAudioJitter, #selectCodec, #hdrModeBtn, #fullRangeBtn, #gameModeBtn, #framePacingBtn,\n' +
        '#disableWarningsBtn, #performanceStatsBtn, #diagnosticsBtn, #navigationGuideBtn, #restartAppBtn',
        '#selectAudio, #playHostAudioBtn,\n' +
        '#selectAudioJitter, #selectCodec, #hdrModeBtn, #fullRangeBtn, #gameModeBtn, #framePacingBtn,\n' +
        '#disableWarningsBtn, #performanceStatsBtn, #diagnosticsBtn, #navigationGuideBtn, #restartAppBtn')
      .replace('#playHostAudioBtn:hover, #playHostAudioBtn:focus, #interfaceSoundsBtn:hover, #interfaceSoundsBtn:focus,\n#selectCodec',
        '#playHostAudioBtn:hover, #playHostAudioBtn:focus, #selectCodec');
  }
  if (file === 'wasm/platform/navigation.js') {
    return source
      .replace("      'playHostAudioBtn',\n      'interfaceSoundsBtn'\n", "      'playHostAudioBtn'\n")
      .replace('      if (typeof InterfaceSounds !== \'undefined\' && typeof InterfaceSounds.start === \'function\') InterfaceSounds.start();\n', '')
      .replace('      if (typeof InterfaceSounds !== \'undefined\' && typeof InterfaceSounds.stop === \'function\') InterfaceSounds.stop();\n', '');
  }
  return source;
}
module.exports = {normalize};
