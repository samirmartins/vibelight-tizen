// Visible startup stages and an explicit cancel action. Native termination owns
// the return after native startup; menu-only cancellation restores the library.
var StreamStartup=(function() {
  var attempt=null,serial=0;
  function el(id){return document.getElementById(id);}
  function clearLegacy(){
    var spinner=el('loadingSpinner'),message=el('loadingSpinnerMessage');
    if(spinner)spinner.style.display='none';if(message)message.textContent='';
  }
  function cover(covered){
    if(!attempt)return;
    var panel=el('streamStartupPanel'),button=el('streamStartupCancel');
    if(panel)panel.hidden=covered;
    if(!covered && button)button.focus();
  }
  function stage(message){
    if(!attempt)return;
    var node=el('streamStartupMessage');
    if(node)node.textContent=typeof MenuI18n!=='undefined' ? MenuI18n.text(message) : message;
  }
  function key(event){
    if(!attempt || (typeof isDialogOpen!=='undefined' && isDialogOpen))return;
    if(event.key==='Enter' || event.key==='Escape' || event.key==='Backspace' || event.keyCode===10009){
      event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)cancelCurrent();
    }
  }
  function finish(){
    attempt=null;var panel=el('streamStartupPanel');if(panel)panel.hidden=true;
    clearLegacy();
    if(document.body)document.body.classList.remove('stream-starting');
    if(document.removeEventListener)document.removeEventListener('keydown',key,true);
  }
  function begin(host,cancel){
    attempt={id:++serial,host:host,cancel:cancel,native:false};
    clearLegacy();
    if(document.body)document.body.classList.add('stream-starting');
    var panel=el('streamStartupPanel'),button=el('streamStartupCancel');
    if(panel)panel.hidden=false;if(button){button.onclick=cancelCurrent;button.focus();}
    if(document.addEventListener)document.addEventListener('keydown',key,true);
    stage('Checking PC…');
    return serial;
  }
  function cancelCurrent(){
    if(!attempt)return;
    var current=attempt;finish();current.cancel();
    if(current.native){
      if(typeof Module!=='undefined' && typeof Module.stopStream==='function')Module.stopStream();
      return;
    }
    // The launch scope has already invalidated pending replies and audio.
    if(typeof api!=='undefined' && api!==current.host)return;
    Promise.resolve(showApps(current.host)).catch(function(){snackbarLogLong('Could not restore the game library.');});
  }
  return {begin:begin,stage:stage,finish:finish,cancel:cancelCurrent,cover:cover,
    native:function(){if(attempt)attempt.native=true;},active:function(){return !!attempt;}};
})();
