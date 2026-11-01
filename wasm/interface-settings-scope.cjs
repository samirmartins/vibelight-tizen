'use strict';
// Exact menu-only interface settings delta. Historical contracts see the
// approved pre-settings source; unknown neighboring edits remain visible.
function normalize(file, source) {
  if (file === 'wasm/index.html') {
    source = source
      .replace('  <link rel="stylesheet" href="static/css/ambient-mode.css">\n', '')
      .replace('  <script type="text/javascript" src="platform/ambient-mode.js"></script>\n' +
        '  <script type="text/javascript" src="platform/interface-sounds.js"></script>\n', '')
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
        '            </div>\n', '')
      .replace('            <div class="setting-option">\n' +
        '              <label>Screensaver</label>\n' +
        '              <span class="mdl-list__item-text-body">\n' +
        '                - Dim the menu after inactivity to reduce retention on OLED/QLED panels. Any input wakes it; gameplay is not dimmed.\n' +
        '              </span>\n' +
        '              <div id="screensaverMenu">\n' +
        '                <button type="button" id="selectScreensaver" class="mdl-button mdl-js-button mdl-js-ripple-effect" data-value="5">5 minutes</button>\n' +
        '              </div>\n' +
        '              <ul class="screensaverMenu mdl-menu mdl-menu--bottom-left mdl-js-menu mdl-js-ripple-effect" for="selectScreensaver">\n' +
        '                <li class="mdl-menu__item" data-value="0">Off</li>\n' +
        '                <li class="mdl-menu__item" data-value="1">1 minute</li>\n' +
        '                <li class="mdl-menu__item" data-value="5">5 minutes</li>\n' +
        '                <li class="mdl-menu__item" data-value="10">10 minutes</li>\n' +
        '              </ul>\n' +
        '            </div>\n', '');
    return source;
  }
  if (file === 'wasm/static/css/style.css') {
    return source
      .replace('#selectAudio, #selectAudioJitter, #selectCodec, #selectScreensaver,\n#navigationGuideBtn',
        '#selectAudio, #selectAudioJitter, #selectCodec, #navigationGuideBtn')
      .replace('#selectAudio, #playHostAudioBtn, #interfaceSoundsBtn,\n' +
        '#selectAudioJitter, #selectCodec, #hdrModeBtn, #fullRangeBtn, #gameModeBtn, #framePacingBtn,\n' +
        '#selectScreensaver, #disableWarningsBtn',
        '#selectAudio, #playHostAudioBtn,\n' +
        '#selectAudioJitter, #selectCodec, #hdrModeBtn, #fullRangeBtn, #gameModeBtn, #framePacingBtn,\n' +
        '#disableWarningsBtn')
      .replace('.audioConfigMenu, .audioJitterMenu, .videoCodecMenu, .screensaverMenu,\n' +
        '.mdl-menu__container',
        '.audioConfigMenu, .audioJitterMenu, .videoCodecMenu, .mdl-menu__container')
      .replace('.audioConfigMenu, .audioJitterMenu, .videoCodecMenu, .screensaverMenu,\n' +
        '.mdl-menu__outline',
        '.audioConfigMenu, .audioJitterMenu, .videoCodecMenu, .mdl-menu__outline')
      .replace('#audioJitterMenu > #selectAudioJitter, #videoCodecMenu > #selectCodec,\n' +
        '#screensaverMenu > #selectScreensaver',
        '#audioJitterMenu > #selectAudioJitter, #videoCodecMenu > #selectCodec')
      .replace('#playHostAudioBtn:hover, #playHostAudioBtn:focus, #interfaceSoundsBtn:hover, #interfaceSoundsBtn:focus,\n#selectCodec',
        '#playHostAudioBtn:hover, #playHostAudioBtn:focus, #selectCodec')
      .replace('#selectScreensaver:hover, #selectScreensaver:focus,\n#disableWarningsBtn',
        '#disableWarningsBtn');
  }
  if (file === 'wasm/platform/navigation.js') {
    return source
      .replace("      'playHostAudioBtn',\n      'interfaceSoundsBtn'\n", "      'playHostAudioBtn'\n")
      .replace("      'framePacingBtn',\n      'selectScreensaver'\n", "      'framePacingBtn'\n")
      .replace("      'performanceStatsBtn',\n      'selectScreensaver',\n", "      'performanceStatsBtn',\n")
      .replace('      if (typeof AmbientMode !== \'undefined\' && typeof AmbientMode.start === \'function\') AmbientMode.start();\n' +
        '      if (typeof InterfaceSounds !== \'undefined\' && typeof InterfaceSounds.start === \'function\') InterfaceSounds.start();\n', '')
      .replace('      if (typeof AmbientMode !== \'undefined\' && typeof AmbientMode.stop === \'function\') AmbientMode.stop();\n' +
        '      if (typeof InterfaceSounds !== \'undefined\' && typeof InterfaceSounds.stop === \'function\') InterfaceSounds.stop();\n', '')
      .replace('  SelectScreensaverMenu: {\n' +
        "    isActive: () => isPopupMenuActive('screensaverMenu'),\n" +
        '    view: new ListView(() =>\n' +
        "      menuItems('screensaverMenu')),\n" +
        '    up: function() {\n' +
        '      this.view.prevOption();\n' +
        '    },\n' +
        '    down: function() {\n' +
        '      this.view.nextOption();\n' +
        '    },\n' +
        '    left: function() {},\n' +
        '    right: function() {},\n' +
        '    accept: function() {\n' +
        '      clickElement(this.view.current());\n' +
        '      closeActiveVisibleMenu();\n' +
        "      setTimeout(() => focusElement('selectScreensaver'), 250);\n" +
        '    },\n' +
        '    back: function() {\n' +
        "      closePopupMenu('selectScreensaver');\n" +
        '      closeActiveVisibleMenu();\n' +
        "      focusElement('selectScreensaver');\n" +
        '    },\n' +
        '    press: function() {},\n' +
        '    switch: function() {},\n' +
        '    enter: function() {\n' +
        '      mark(this.view.current());\n' +
        '    },\n' +
        '    leave: function() {\n' +
        '      unmark(this.view.current());\n' +
        '    },\n' +
        '  },\n', '');
  }
  return source;
}
module.exports = {normalize};
