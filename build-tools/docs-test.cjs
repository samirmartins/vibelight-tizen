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
assert.equal(core.languageHref('../','es','compare'),'../es/index.html?lang=es#compare');
assert.equal(core.languageHref('./','en','audio-buffer'),'./index.html?lang=en#audio-buffer');
assert.equal(core.languageHref('./','invalid','home'),'./index.html?lang=en#home');
const root=path.resolve(__dirname,'..');
const {metadata}=require('./build-docs.cjs');
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
 assert(html.includes(metadata.published) && /datetime="\d{4}-\d{2}-\d{2}"/.test(html),'published version and review date are explicit');
 for(const id of ids)assert(html.includes('id="'+id+'"'),code+' '+id);
 assert(html.includes('hreflang="en"') && html.includes('hreflang="pt-BR"') && html.includes('hreflang="es"'));
}
// Release documents follow the single published version declared for the site
// (build-docs.cjs). The app may already be a newer, unpublished candidate, and
// the CMake project version always follows res/config.xml.
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const semver=value=>{assert(/^[0-9]+\.[0-9]+\.[0-9]+$/.test(value),'version '+value);return value.split('.').map(Number);};
const notOlder=(a,b)=>{const x=semver(a),y=semver(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return true;};
function checkRelease(published,docs){
 const tag='https://github.com/samirmartins/vibelight-tizen/releases/tag/v'+published,anchor='v'+published.replace(/\./g,'');
 const app=(docs['res/config.xml'].match(/<widget [^>]*\bversion="([0-9.]+)"/)||[])[1];
 const cmake=(docs['CMakeLists.txt'].match(/^project\(MoonlightWasm VERSION ([0-9.]+)\)$/m)||[])[1];
 assert.equal(cmake,app,'CMakeLists.txt project version follows res/config.xml');
 assert(notOlder(app,published),'app version '+app+' is the published release or a newer candidate');
 const readme=docs['README.md'];
 assert.equal((readme.match(/Latest release: \[v/g)||[]).length,1,'one latest-release line in README.md');
 assert(readme.includes('**Latest release: ['+'v'+published+']('+tag+')**'),'README.md names the published release');
 assert(readme.includes('(CHANGELOG.md#'+anchor+')'),'README.md links the published changelog section');
 assert(docs['INSTALLATION.md'].includes('It covers [v'+published+']('+tag+').'),'INSTALLATION.md covers the published release');
 const tools=docs['build-tools/README.md'];
 assert(tools.includes('(../CHANGELOG.md#'+anchor+')')&&tools.includes('describe v'+published+'.'),'build-tools/README.md describes the published release');
 assert.equal(docs['RELEASE_NOTES.md'].split('\n')[0],'# Moonlight Tizen v'+published,'RELEASE_NOTES.md title');
 assert(new RegExp('^## v'+published.replace(/\./g,'\\.')+'$','m').test(docs['CHANGELOG.md']),'CHANGELOG.md section for the published release');
}
const releaseFiles=['res/config.xml','CMakeLists.txt','README.md','INSTALLATION.md','build-tools/README.md','RELEASE_NOTES.md','CHANGELOG.md'];
const release=Object.fromEntries(releaseFiles.map(file=>[file,read(file)]));
checkRelease(metadata.published,release);
// Negative controls: a stale page or a CMake version that lags behind are rejected.
assert.throws(()=>checkRelease(metadata.published,{...release,'INSTALLATION.md':release['INSTALLATION.md'].replaceAll('v'+metadata.published,'v0.0.1')}),/INSTALLATION/);
assert.throws(()=>checkRelease(metadata.published,{...release,'CMakeLists.txt':release['CMakeLists.txt'].replace(/(project\(MoonlightWasm VERSION )[0-9.]+/,'$10.0.1')}),/CMakeLists/);
assert.throws(()=>checkRelease('999.0.0',release),/app version/);

// Offline check of every relative link and anchor in the repository Markdown.
const slug=heading=>heading.trim().toLowerCase().replace(/<[^>]+>/g,'').replace(/[^\p{L}\p{N}\s_-]/gu,'').replace(/\s/g,'-');
function anchors(text){
 const seen=new Map(),out=new Set();
 for(const line of text.replace(/```[\s\S]*?```/g,'').split('\n')){
  const match=line.match(/^#{1,6}\s+(.*)$/);if(!match)continue;
  const base=slug(match[1]),count=seen.get(base)||0;seen.set(base,count+1);out.add(count?base+'-'+count:base);
 }
 return out;
}
function brokenLinks(files,readFile,exists){
 const broken=[];let checked=0;
 for(const file of files){
  const text=readFile(file).replace(/```[\s\S]*?```/g,'').replace(/`[^`\n]*`/g,'');
  for(const match of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(?:src|srcset|href)="([^"]+)"/g)){
   const link=match[1]||match[2];if(/^(https?:|mailto:)/.test(link))continue;checked++;
   const [target,hash]=link.split('#'),resolved=target?path.posix.normalize(path.posix.join(path.posix.dirname(file),decodeURIComponent(target))):file;
   if(!exists(resolved))broken.push(file+' -> '+link);
   else if(hash&&resolved.endsWith('.md')&&!anchors(readFile(resolved)).has(hash.toLowerCase()))broken.push(file+' -> '+link+' (anchor)');
  }
 }
 return {broken,checked};
}
const markdown=require('child_process').execFileSync('git',['ls-files','*.md'],{cwd:root,encoding:'utf8'}).split('\n')
 .filter(file=>file&&!/^(opus|moonlight-common-c|h264bitstream|libgamestream)\//.test(file));
const links=brokenLinks(markdown,read,file=>fs.existsSync(path.join(root,file)));
assert.deepStrictEqual(links.broken,[],'broken Markdown links');
assert(markdown.includes('README.md')&&links.checked>20,'repository Markdown inspected');
const fake={'a.md':'[ok](b.md#title) [bad](missing.md) [anchor](b.md#nope) `[code](ignored.md)`','b.md':'# Title\n'};
assert.deepStrictEqual(brokenLinks(['a.md'],f=>fake[f],f=>f in fake).broken,['a.md -> missing.md','a.md -> b.md#nope (anchor)']);
console.log('docs-test: three-language parity, accent-aware answer search, excerpts, stable routes, locale links, release version '+metadata.published+' across documents and '+links.checked+' Markdown links PASS');
