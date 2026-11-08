// Static, local navigation and search. No analytics, remote fonts or requests.
(function(){
  'use strict';
  var articles=Array.from(document.querySelectorAll('article'));
  var links=Array.from(document.querySelectorAll('nav a'));
  var navigation=document.getElementById('navigation'),menu=document.getElementById('menu');
  function fold(s){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
  function show(event){
    var id=location.hash.slice(1) || 'comecar',target=document.getElementById(id);
    var article=target && (target.tagName==='ARTICLE' ? target : target.closest('article')) || articles[0];
    articles.forEach(function(n){n.hidden=n!==article;});
    links.forEach(function(link){if(link.hash==='#'+article.id)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
    document.title=article.dataset.title+' · VibeLight';
    navigation.classList.remove('open');menu.setAttribute('aria-expanded','false');
    if(event)document.getElementById('conteudo').focus({preventScroll:true});
    if(target && target!==article)target.scrollIntoView();else window.scrollTo(0,0);
  }
  window.addEventListener('hashchange',show);show();
  menu.onclick=function(){var open=navigation.classList.toggle('open');menu.setAttribute('aria-expanded',String(open));};
  var index=articles.map(function(n){return{id:n.id,title:n.dataset.title,text:fold(n.textContent)};});
  document.getElementById('search').addEventListener('input',function(){
    var query=fold(this.value.trim()),results=document.getElementById('results');results.textContent='';
    if(!query)return;
    var matches=index.filter(function(item){return item.text.includes(query);});
    if(!matches.length){results.textContent='Nenhum guia encontrado.';return;}
    matches.forEach(function(item){var link=document.createElement('a');link.href='#'+item.id;link.textContent=item.title;results.appendChild(link);});
  });
})();
