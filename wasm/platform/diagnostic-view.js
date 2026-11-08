// Menu-only rendering of local summaries. No live instrumentation or network.
var DiagnosticView=(function() {
  'use strict';
  var records=[],chosen=DiagnosticHistory.selection(),mode='history',current=null,page=0,returnId='',fromHistory=false;
  function el(id){return document.getElementById(id);}
  function tr(s){return typeof MenuI18n!=='undefined' ? MenuI18n.text(s) : s;}
  function node(tag,text,className){var n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
  function fmt(n){return typeof n==='number' && isFinite(n) ? n.toFixed(Math.abs(n)>=100 ? 0 : 2) : tr('No data');}
  function duration(ms){return (Math.max(0,ms)/60000).toFixed(1)+' min';}
  function date(r){return r.legacy ? tr('Previous report') : new Date(r.createdAt).toLocaleString(typeof MenuI18n!=='undefined' ? MenuI18n.locale() : 'en',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}
  function context(r){return [date(r),r.game || '',r.config.stream || r.legacyConfig || '',
    tr('Recorded')+': '+duration(r.recordedMs)+' / '+duration(r.durationMs),
    r.recordedMs<r.durationMs ? tr('Partial coverage') : tr('Full coverage')].filter(Boolean).join(' · ');}
  function button(id,label,fn,disabled){var b=node('button',tr(label),'diagnosis-button');b.type='button';b.id=id;b.disabled=!!disabled;b.onclick=fn;return b;}
  function open(){
    var ids=Array.prototype.map.call(el('diagnosisDialog').querySelectorAll('button:not(:disabled)'),function(b){return b.id;});
    if(el('diagnosisDialog').open){
      Views.UtilityDialog.controls=ids;Views.UtilityDialog.closeId='diagnosisClose';Views.UtilityDialog.view.index=Math.max(0,ids.indexOf(returnId));
      var focus=returnId && el(returnId) || el(ids[0]);if(focus)focus.focus();returnId='';
    }else openUtilityDialog('diagnosisDialog',ids,'diagnosisClose');
  }
  function clear(title){
    el('diagnosisDialog').setAttribute('data-view',mode);
    ['diagnosisConfig','diagnosisDevice','diagnosisRows','diagnosisList'].forEach(function(id){el(id).setAttribute('data-i18n-skip','true');});
    el('diagnosisTitle').textContent=tr(title);
    ['diagnosisConfig','diagnosisDevice','diagnosisRows','diagnosisFinding','diagnosisPeak','diagnosisFoot','diagnosisActions','diagnosisList'].forEach(function(id){el(id).textContent='';});
    el('diagnosisPrivacy').textContent=tr('Statistics stay on this TV. Nothing is sent. Last 10 session records.');
  }
  function addRows(rows){rows.forEach(function(row){var r=node('tr');r.appendChild(node('th',tr(row[0])));r.appendChild(node('td',tr(row[1])));el('diagnosisRows').appendChild(r);});}
  function close(){chosen.clear();closeUtilityDialog('diagnosisDialog');}
  function backButton(fn){el('diagnosisActions').appendChild(button('diagnosisClose',fn ? 'Back' : 'Close',fn || close));}
  function load(){
    if(isInGame || isDialogOpen)return false;
    var result=DiagnosticHistory.create().list();
    if(!result.ok){snackbarLogLong('Could not read diagnosis history. Saved records were preserved.');return false;}
    records=result.records;chosen.clear();return true;
  }
  function history(){
    mode='history';clear('Diagnosis history');
    el('diagnosisConfig').textContent=tr('Choose any two records to compare. OK selects or deselects.');
    if(!records.length)el('diagnosisFinding').textContent=tr('No saved diagnosis. Enable statistics in the game menu first.');
    var ids=chosen.ids();
    records.forEach(function(r,i){
      var index=ids.indexOf(r.id),label=(index<0 ? '□' : index===0 ? 'A' : 'B')+' · '+context(r);
      var b=button('diagnosis-record-'+i,label,function(){
        if(!chosen.toggle(r.id)){snackbarLogLong('Deselect a record before choosing another.');return;}
        returnId=b.id;history();
      });
      b.textContent='';
      [index<0 ? '□' : index===0 ? 'A' : 'B',date(r),r.game || tr('Previous report'),r.config.stream || r.legacyConfig || tr('No data'),duration(r.recordedMs)].forEach(function(value){b.appendChild(node('span',value));});
      b.className+=' diagnosis-record'+(index<0 ? '' : index===0 ? ' selected-a' : ' selected-b');
      b.setAttribute('aria-pressed',index<0 ? 'false' : 'true');el('diagnosisList').appendChild(b);
    });
    el('diagnosisFinding').textContent=(records.length ? ids.length+' / 2 · '+tr('Selected') : el('diagnosisFinding').textContent);
    el('diagnosisActions').appendChild(button('diagnosisViewSelected','View selected record',function(){
      current=records.find(function(r){return r.id===chosen.ids()[0];});fromHistory=true;page=0;report(false);
    },ids.length!==1));
    el('diagnosisActions').appendChild(button('diagnosisCompare','Compare 2 records',function(){page=0;compare();},ids.length!==2));
    el('diagnosisActions').appendChild(button('diagnosisClear','Clear selection',function(){chosen.clear();history();},!ids.length));
    backButton();open();
  }
  function report(details){
    mode=details ? 'details' : 'report';clear(details ? 'Technical details' : 'Last diagnosis');
    el('diagnosisConfig').textContent=context(current);el('diagnosisDevice').textContent=current.device || '';
    addRows(details ? current.details : current.rows);
    el('diagnosisFinding').textContent=tr(current.finding || '');
    if(details){el('diagnosisPeak').textContent=current.peak || '';el('diagnosisFoot').textContent=tr(current.foot || '');}
    else el('diagnosisActions').appendChild(button('diagnosisDetails','Technical details',function(){report(true);},!current.details.length));
    backButton(details ? function(){report(false);} : fromHistory ? history : null);open();
  }
  function compare(){
    var ids=chosen.ids();if(ids.length!==2)return;
    mode='compare';clear('Compare diagnoses');
    var a=records.find(function(r){return r.id===ids[0];}),b=records.find(function(r){return r.id===ids[1];});
    el('diagnosisConfig').textContent='A · '+context(a);el('diagnosisDevice').textContent='B · '+context(b);
    var configKeys=['stream','variant','version','build','pacing','gameMode','hdr','bitrate','audio','audioLimitMs'];
    var differences=configKeys.filter(function(k){return a.config[k]!==b.config[k];});
    el('diagnosisFinding').textContent=tr('Differences B − A. Consider configuration, scene and recorded duration.')+
      (differences.length ? ' '+tr('Different settings')+': '+differences.map(function(k){return tr(k);}).join(', ') : '');
    var header=node('tr');['Metric','Session A','Session B','Difference B − A'].forEach(function(v){header.appendChild(node('th',tr(v)));});el('diagnosisRows').appendChild(header);
    DiagnosticHistory.compare(a,b).slice(page*8,page*8+8).forEach(function(r){
      var row=node('tr');row.appendChild(node('th',tr(r.label)));
      [r.a,r.b,r.delta].forEach(function(v,i){var label=fmt(v)+(v===null ? '' : ' '+(i===2 && r.unit==='%' ? 'p.p.' : r.unit));
        if(i===2 && v>0)label='+'+label;
        var cell=node('td',label);
        if(i<2 && r.unit==='/min' && typeof (i===0 ? r.countA : r.countB)==='number')
          cell.appendChild(node('small',(i===0 ? r.countA : r.countB)+' / '+duration(i===0 ? a.recordedMs : b.recordedMs)));
        row.appendChild(cell);
      });el('diagnosisRows').appendChild(row);
    });
    el('diagnosisFoot').textContent=(page+1)+' / 3 · '+tr('No automatic winner. Missing values are not zero.');
    el('diagnosisActions').appendChild(button('diagnosisPrev','Previous',function(){page--;compare();},page===0));
    el('diagnosisActions').appendChild(button('diagnosisNext','Next',function(){page++;compare();},page===2));
    backButton(history);open();
  }
  return {
    latest:function(){if(!load())return;if(!records.length){history();return;}current=records[0];fromHistory=false;report(false);},
    history:function(){if(load())history();},
    // All state stays within this menu visit; nothing is written by comparison.
    isOpen:function(){return !!el('diagnosisDialog').open;}
  };
})();
