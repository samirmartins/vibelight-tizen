/* Local navigation, explicit language choice and answer-level search. */
(function(){
  'use strict';
  var core=GuideCore,root=document.documentElement,locale=root.dataset.locale,base=root.dataset.root;
  var storageKey='vibelight.docs.language.v1',codes=['en','pt-br','es'];
  var pages=Array.from(document.querySelectorAll('[data-page]')),layout=document.getElementById('guide-layout');
  var picker=document.querySelector('.language-picker'),mobile=document.querySelector('.mobile-contents');
  var dialog=document.getElementById('search-dialog'),input=document.getElementById('search'),results=document.getElementById('results'),status=document.getElementById('search-status');
  var returnFocus=null;
  function currentId(){var value=location.hash.slice(1);try{value=decodeURIComponent(value);}catch(error){}return core.canonical(value);}
  // A first visit is always English. Only an explicit earlier choice is restored.
  if(locale==='en'){
    try{var saved=localStorage.getItem(storageKey);if(codes.includes(saved)&&saved!=='en'){location.replace(core.languageHref(base,saved,currentId()));return;}}catch(error){}
  }
  function updateLanguages(){
    document.querySelectorAll('[data-language]').forEach(function(link){link.href=core.languageHref(base,link.dataset.language,currentId());});
  }
  document.querySelectorAll('[data-language]').forEach(function(link){link.addEventListener('click',function(){
    try{localStorage.setItem(storageKey,link.dataset.language);}catch(error){}
  });});
  function closePicker(){picker.open=false;}
  document.addEventListener('click',function(event){if(!picker.contains(event.target))closePicker();});
  function heading(section){return section.querySelector('h2').firstChild.textContent.trim();}
  var index=Array.from(document.querySelectorAll('[data-search]')).map(function(section){
    return{id:section.id,title:heading(section),chapter:section.closest('[data-page]').dataset.label,
      keywords:section.dataset.keywords||'',text:Array.from(section.querySelectorAll('p,h3,li')).filter(function(n){return n.tagName!=='LI'||!n.querySelector('p');}).map(function(n){return n.textContent;}).join(' ')};
  });
  function show(event){
    var id=currentId(),target=document.getElementById(id),page=target&&target.closest('[data-page]')||document.getElementById('home');
    pages.forEach(function(n){n.hidden=n!==page;});layout.hidden=page.id==='home';
    document.body.classList.toggle('is-guide',page.id!=='home');
    document.querySelectorAll('[data-guide-link]').forEach(function(link){if(link.hash==='#'+page.id)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
    document.title=page.dataset.label+' · VibeLight';
    if(page.id==='home')document.title=root.dataset.pageTitle;
    var toc=document.getElementById('topic-links');toc.textContent='';
    page.querySelectorAll('[data-search]').forEach(function(section){var link=document.createElement('a');link.href='#'+section.id;link.textContent=heading(section);toc.appendChild(link);});
    mobile.open=false;closePicker();if(dialog.open)dialog.close();updateLanguages();
    if(event)document.getElementById('content').focus({preventScroll:true});
    if(target&&target!==page&&page.contains(target))target.scrollIntoView({block:'start'});else window.scrollTo(0,0);
  }
  root.dataset.pageTitle=document.title;
  window.addEventListener('hashchange',show);show();
  function renderResults(){
    results.textContent='';var query=input.value.trim();
    if(!query){status.textContent=status.dataset.prompt;return;}
    var matches=core.search(index,query);status.textContent=matches.length?status.dataset.count.replace('{count}',matches.length):status.dataset.empty;
    matches.forEach(function(item){
      var row=document.createElement('li'),link=document.createElement('a'),chapter=document.createElement('small'),title=document.createElement('strong'),excerpt=document.createElement('p');
      link.href='#'+item.id;chapter.textContent=item.chapter;title.textContent=item.title;excerpt.textContent=item.excerpt;
      link.append(chapter,title,excerpt);row.appendChild(link);results.appendChild(row);
      link.addEventListener('click',function(){if(location.hash==='#'+item.id){dialog.close();show(true);}else dialog.close();});
    });
  }
  document.querySelectorAll('.search-trigger').forEach(function(trigger){
    trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-controls','search-dialog');
    trigger.addEventListener('click',function(){returnFocus=trigger;closePicker();renderResults();dialog.showModal();input.focus();});
  });
  dialog.addEventListener('close',function(){if(returnFocus&&returnFocus.isConnected)returnFocus.focus();});
  dialog.addEventListener('click',function(event){if(event.target===dialog){var r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  input.addEventListener('input',renderResults);
  dialog.addEventListener('keydown',function(event){
    var links=Array.from(results.querySelectorAll('a')),at=links.indexOf(document.activeElement);
    if(event.key==='ArrowDown'&&links.length){event.preventDefault();links[Math.min(at+1,links.length-1)].focus();}
    if(event.key==='ArrowUp'&&links.length){event.preventDefault();if(at<=0)input.focus();else links[at-1].focus();}
  });
  document.addEventListener('keydown',function(event){
    if(event.key==='Escape'&&dialog.open){event.preventDefault();event.stopPropagation();dialog.close();return;}
    if(event.key==='Escape'&&picker.open){event.preventDefault();closePicker();picker.querySelector('summary').focus();}
    if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!dialog.open&&!event.target.closest('input,textarea,[contenteditable="true"]')){event.preventDefault();document.querySelector('.search-trigger').click();}
  });
})();
