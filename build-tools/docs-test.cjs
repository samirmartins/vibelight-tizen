'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const core=require('../docs/assets/guide-core.js');
const entries=[
 {id:'audio-buffer',title:'Buffer de áudio',text:'O limite do buffer não é um atraso fixo. Cortes de áudio podem precisar de mais margem.',keywords:'som audio jitter'},
 {id:'pair-pin',title:'Parear o PC',text:'Digite o PIN mostrado na TV na interface do host.',keywords:'pair pairing pin'},
 {id:'video-latency',title:'Latência ultrabaixa',text:'Modo separado do ForceGM. Pode ser instável em algumas TVs.',keywords:'lag latency'}
];
assert.equal(core.search(entries,'audio buffer')[0].id,'audio-buffer');
assert.equal(core.search(entries,'ÁUDIO')[0].id,'audio-buffer');
assert.equal(core.search(entries,'PIN')[0].id,'pair-pin');
assert.equal(core.search(entries,'lag')[0].id,'video-latency');
assert.equal(core.search(entries,'   ').length,0);
assert.equal(core.search(entries,'<script>alert(1)</script>').length,0);
assert.equal(core.search(entries,'pin buffer').length,0,'all query terms must match the same answer');
assert(core.search(entries,'áudio')[0].excerpt.includes('buffer'));
assert(core.excerpt('Before. '+('word '.repeat(100))+' target answer. End.','target',100).includes('target'));
assert.equal(core.canonical('diagnostico'),'diagnostics');
assert.equal(core.canonical('atualizar'),'update');
assert.equal(core.languageHref('../','es','compare'),'../es/index.html#compare');
assert.equal(core.languageHref('./','en','audio-buffer'),'./index.html#audio-buffer');
assert.equal(core.languageHref('./','invalid','home'),'./index.html#home');
const root=path.resolve(__dirname,'..');
const codes=['en','pt-br','es'];let previous;
for(const code of codes){
 const data=JSON.parse(fs.readFileSync(path.join(root,'docs/_source',code+'.json'),'utf8'));
 assert.equal(data.locale,code);assert(data.ui.language && data.home.title);
 const ids=data.articles.flatMap(a=>[a.id,...a.sections.map(s=>s.id)]);
 assert.equal(new Set(ids).size,ids.length,'unique topic IDs '+code);
 if(previous)assert.deepStrictEqual(ids,previous,'all languages cover the same topics');previous=ids;
 const file=path.join(root,'docs',code==='en'?'index.html':code+'/index.html');
 const html=fs.readFileSync(file,'utf8');
 assert(html.includes('lang="'+(code==='pt-br'?'pt-BR':code)+'"'));
 assert(!/undefined|TODO|Lorem ipsum|\{\{/.test(html));
 assert(html.includes('4.0.2') && /datetime="\d{4}-\d{2}-\d{2}"/.test(html),'published version and review date are explicit');
 for(const id of ids)assert(html.includes('id="'+id+'"'),code+' '+id);
 assert(html.includes('hreflang="en"') && html.includes('hreflang="pt-BR"') && html.includes('hreflang="es"'));
}
console.log('docs-test: three-language parity, accent-aware answer search, excerpts, stable routes and locale links PASS');
