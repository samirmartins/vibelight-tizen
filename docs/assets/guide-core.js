/* Shared documentation behavior. No DOM, storage or network on load. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.GuideCore=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var aliases={comecar:'home',instalar:'install',parear:'pair',jogar:'play',configuracoes:'settings',diagnostico:'diagnostics',problemas:'troubleshooting',sobre:'about',atualizar:'update',requisitos:'requirements',apps2samsung:'install-tv',wake:'wake-pc','menu-jogo':'game-menu',latencia:'video-latency',audio:'audio-buffer',metricas:'metrics'};
  function normalize(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();}
  function canonical(id){return aliases[id]||id||'home';}
  function excerpt(text,query,limit){
    text=String(text).replace(/\s+/g,' ').trim();limit=limit||165;
    var terms=normalize(query).split(' ').filter(Boolean),folded=normalize(text),at=-1;
    terms.some(function(term){at=folded.indexOf(term);return at>=0;});
    var start=at>65?text.lastIndexOf(' ',at-45)+1:0,end=Math.min(text.length,start+limit);
    if(end<text.length){var boundary=text.lastIndexOf(' ',end);if(boundary>start+40)end=boundary;}
    return (start?'…':'')+text.slice(start,end)+(end<text.length?'…':'');
  }
  function search(entries,query){
    var terms=normalize(query).split(' ').filter(Boolean);if(!terms.length)return[];
    return entries.map(function(entry,index){
      var title=normalize(entry.title),haystack=normalize(entry.title+' '+entry.text+' '+(entry.keywords||''));
      if(!terms.every(function(term){return haystack.includes(term);}))return null;
      return Object.assign({},entry,{score:terms.reduce(function(n,term){return n+(title.includes(term)?4:1);},0),order:index,excerpt:excerpt(entry.text,query)});
    }).filter(Boolean).sort(function(a,b){return b.score-a.score||a.order-b.order;}).slice(0,8);
  }
  function languageHref(base,locale,id){
    if(!['en','pt-br','es'].includes(locale))locale='en';
    return base+({en:'index.html','pt-br':'pt-br/index.html',es:'es/index.html'}[locale])+'?lang='+locale+'#'+canonical(id);
  }
  return{normalize:normalize,canonical:canonical,excerpt:excerpt,search:search,languageHref:languageHref};
});
