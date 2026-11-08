// Menu-only help. The QR and destination are bundled; no remote QR service.
var GuideHelp=(function(){
  function close(){closeUtilityDialog('guideHelpDialog');}
  function open(){
    if(isInGame || isDialogOpen || document.hidden)return;
    document.getElementById('guideHelpClose').onclick=close;
    document.getElementById('guideHelpControls').onclick=function(){
      close();
      navigationGuideDialog(open);
    };
    openUtilityDialog('guideHelpDialog',['guideHelpClose','guideHelpControls'],'guideHelpClose','navigationGuideBtn');
  }
  return {open:open};
})();
