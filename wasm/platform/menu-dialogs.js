// Legacy menu dialogs share cancellation, including native Escape/close events.
// Existing button handlers keep ownership of requests, cleanup and navigation.
var MenuDialogs=(function(){
  var latest=null;
  function prepare(dialog,cancelId,view,options){
    options=options || {};
    var parent=Navigation.current(),opener=typeof options.opener==='string' ? document.getElementById(options.opener) : options.opener;
    if(!opener || !opener.getClientRects().length)opener=document.activeElement;
    if((!opener || !opener.id) && parent && parent.view){
      var target=typeof Views!=='undefined' && parent===Views.Apps ? document.querySelector('#game-grid .console-card[tabindex="0"]') : parent.view.current();
      opener=typeof resolveElement==='function' ? resolveElement(target) : typeof target==='string' ? document.getElementById(target) : target;
    }
    if(parent && parent.view && opener){
      var index=Array.prototype.findIndex.call(parent.view.func(),function(item){return (typeof item==='string' ? item : item.id)===opener.id || typeof resolveElement==='function' && resolveElement(item)===opener;});
      if(index>=0)parent.view.index=index;
    }
    var visit={},settled=false;dialog.menuVisit=visit;latest=visit;
    if(!dialog.menuClose){
      dialog.menuClose=dialog.close;
      // Some polyfills throw if an externally closed dialog is closed again.
      dialog.close=function(){
        if(this.open){var done=this.menuClosed,result=this.menuClose.apply(this,arguments);if(done)done();return result;}
      };
    }
    dialog.oncancel=function(event){event.preventDefault();var button=document.getElementById(cancelId);if(button)button.click();};
    var complete=function(){
      Promise.resolve().then(function(){
        if(settled || latest!==visit || dialog.menuVisit!==visit || dialog.open)return;
        if(isDialogOpen && Navigation.isCurrent(view)){
          if(options.externalCancel)options.externalCancel();
          else{var button=document.getElementById(cancelId);if(button)button.click();}
        }
        settled=true;
        if(!isDialogOpen && !isInGame && !document.hidden && Navigation.isCurrent(parent) &&
            !(typeof StreamStartup!=='undefined' && StreamStartup.active()) &&
            opener && opener.isConnected && opener.getClientRects().length)opener.focus();
      });
    };
    dialog.menuClosed=complete;dialog.onclose=complete;
  }
  return {prepare:prepare};
})();
