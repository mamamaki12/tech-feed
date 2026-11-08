// ブラウザで動かす確認（記事画面の安全な表示・CSP・電波がないとき・壊れた保存データ）。
// Playwright（Chromium）がある環境でだけ動かし、ない環境（GitHub Actions の記事収集など）では飛ばす。
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {handle,resetHosts} from '../worker/src/index.js';
import {READER_PROXY} from '../docs/config.js';
const require=createRequire(import.meta.url);
let chromium=null;try{({chromium}=require('playwright'));}catch{}
let browser=null;
before(async()=>{if(chromium)try{browser=await chromium.launch();}catch{}});
after(async()=>{await browser?.close();});
const unavailable=t=>{if(browser)return false;t.skip('Playwright（Chromium）がないため省略');return true;};
const SITE='https://mamamaki12.github.io/tech-feed/';
const types={js:'text/javascript',html:'text/html; charset=utf-8',json:'application/json',css:'text/css',png:'image/png',svg:'image/svg+xml',ico:'image/x-icon',webmanifest:'application/manifest+json'};
const payloads=[
 `<img src=x onerror="window.__xss='img'">`,
 `<svg onload="window.__xss='svg'"><script>window.__xss='svg-script'</script></svg>`,
 `<math><mtext><table><mglyph><style><img src=x onerror="window.__xss='math'">`,
 `<svg></p><style><a id="</style><img src=x onerror=window.__xss='svg-style'>">`,
 `<noscript><p title="</noscript><img src=x onerror=window.__xss='noscript'>"></p></noscript>`,
 `<a href="javascript:window.__xss='js'">a</a><a href=" JaVaScRiPt:window.__xss='js2'">b</a><a href="java&#x09;script:window.__xss='js3'">c</a><a href="data:text/html,x">d</a>`,
 `<iframe src="javascript:parent.__xss='iframe'"></iframe><iframe srcdoc="<script>parent.__xss='srcdoc'</script>"></iframe><object data="x"></object><embed src="x">`,
 `<form action="javascript:window.__xss='form'"><button formaction="javascript:x">x</button><input autofocus onfocus="window.__xss='focus'"></form>`,
 `<details open ontoggle="window.__xss='details'">d</details><body onload="window.__xss='body'">`,
 `<meta http-equiv="refresh" content="0;url=javascript:x"><base href="https://evil.example/"><link rel=stylesheet href="https://evil.example/x.css"><style>*{color:red}</style>`,
 `<div style="background:url(https://evil.example/t)" class="x" id="reader-content">s</div><img src="https://img.example/a.png" srcset="https://evil.example/b 1x" onload="window.__xss='onload'">`,
 `<xmp><img src=x onerror="window.__xss='xmp'"></xmp><noembed><img src=x onerror="window.__xss='noembed'"></noembed><title><img src=x onerror="window.__xss='title'"></title>`,
 `<template><img src=x onerror="window.__xss='template'"></template><!--<img src=x onerror="window.__xss='comment'">-->`,
 `<img src="https://img.example/c.png" alt="&quot;&gt;&lt;img src=x onerror=window.__xss='alt'&gt;"><image src=x onerror="window.__xss='image'">`,
 `<form><math><mtext></form><form><mglyph><style></math><img src onerror="window.__xss='form-math'">`,
 `<p><table><tr><td><svg><p><style><img src=x onerror="window.__xss='table-svg'"></style></p></svg></td></tr></table></p>`,
 `<plaintext><img src=x onerror="window.__xss='plaintext'">`,
];
const filler='<p>'+'これは本文の段落です。読みやすさを確かめるために、十分な長さの文章を用意しています。'.repeat(5)+'</p>';
// アプリで開く記事のページ。本文の途中に、よくある仕掛けをいくつか混ぜる（全部の種類は上の sanitize のテストで見る）。
const inline=[`<img src=x onerror="window.__xss='img'">`,`<a href="javascript:window.__xss='js'">リンク</a>`,`<svg onload="window.__xss='svg'"></svg>`,`<iframe src="javascript:parent.__xss='iframe'"></iframe>`,`<span style="color:red" onclick="window.__xss='click'">装飾</span>`,`<base href="https://evil.example/">`,`<meta http-equiv="refresh" content="0;url=https://evil.example/">`];
const articlePage=`<!doctype html><html><head><title>先読みできる記事 | テスト媒体</title></head><body><header><a href="/">トップ</a></header><article><h1>先読みできる記事</h1>${filler}<p>詳しくは<a href="../docs/guide">こちらの説明</a>を見てください。設定の手順と注意点を、画面の写真つきで順番にまとめています。</p>${filler}<p>${inline.join('')}仕掛けの後ろにも本文が続きます。表示が崩れたり、別のページに移ったりしないことを確かめます。</p>${filler}</article></body></html>`;
function relay(pages){
 return async route=>{
  resetHosts();
  const fetcher=async url=>{if(url.endsWith('/tech-feed/hosts.json'))return Response.json(['blog.example']);const body=pages[url];return body?new Response(body,{headers:{'Content-Type':'text/html; charset=utf-8'}}):new Response('missing',{status:404});};
  const res=await handle(new Request(route.request().url(),{headers:{Origin:'https://mamamaki12.github.io'}}),fetcher);
  await route.fulfill({status:res.status,headers:Object.fromEntries(res.headers),body:Buffer.from(await res.arrayBuffer())});
 };
}
async function openApp({storage}={}){
 const context=await browser.newContext({serviceWorkers:'block',locale:'ja-JP',timezoneId:'Asia/Tokyo'});
 const now=Date.now(),articles={updatedAt:new Date(now).toISOString(),sources:[{name:'テスト媒体',url:'https://blog.example/rss',ok:true,count:2}],articles:[
  {url:'https://blog.example/posts/prefetched',title:'先読みできる記事',source:'テスト媒体',published:new Date(now-3600e3).toISOString(),body:'本文'},
  {url:'https://blog.example/posts/missing',title:'先読みできない記事',source:'テスト媒体',published:new Date(now-7200e3).toISOString(),body:''}]};
 await context.route(`${SITE}**`,async route=>{
  const path=new URL(route.request().url()).pathname.replace('/tech-feed/','')||'index.html';
  if(path==='articles.json')return route.fulfill({contentType:types.json,body:JSON.stringify(articles)});
  try{await route.fulfill({contentType:types[path.split('.').pop()]||'application/octet-stream',body:await readFile(new URL(`../docs/${path}`,import.meta.url))});}catch{await route.fulfill({status:404,body:''});}
 });
 await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.fulfill({contentType:'text/css',body:''}));
 await context.route(`${READER_PROXY}**`,relay({'https://blog.example/posts/prefetched':articlePage}));
 await context.route(/^https:\/\/(blog|img|evil)\.example\//,route=>route.fulfill({status:404,body:''}));
 await context.addInitScript(storage=>{
  window.__csp=[];addEventListener('securitypolicyviolation',e=>window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  if(storage&&!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');for(const [k,v] of Object.entries(storage))localStorage.setItem(k,v);}
 },storage||null);
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(SITE);
 await page.waitForSelector('.article .title');
 return {context,page,errors};
}
// 先読みした本文がブラウザ内（IndexedDB）に保存されるまで待つ。アプリより先にデータベースを作らないよう、無ければ作らずに待つ。
async function stored(page,url){
 for(let i=0;i<60;i++){
  const ok=await page.evaluate(url=>new Promise(resolve=>{const req=indexedDB.open('tech-feed-reader',1);req.onupgradeneeded=()=>req.transaction.abort();req.onerror=()=>resolve(false);req.onsuccess=()=>{const g=req.result.transaction('articles').objectStore('articles').get(url);g.onsuccess=()=>{resolve(Boolean(g.result?.content));req.result.close();};g.onerror=()=>resolve(false);};}),url);
  if(ok)return;await page.waitForTimeout(300);
 }
 throw new Error(`${url} が先読みされない`);
}
test('The reader sanitizer keeps only safe markup for known XSS tricks',async t=>{
 if(unavailable(t))return;
 const page=await browser.newPage();
 await page.route('https://reader.test/**',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/')return route.fulfill({contentType:types.html,body:'<!doctype html><div id="out"></div>'});try{await route.fulfill({contentType:types.js,body:await readFile(new URL(`../docs${path}`,import.meta.url))});}catch{await route.fulfill({status:404,body:''});}});
 await page.route(/^https:\/\/(?!reader\.test)/,route=>route.fulfill({status:404,body:''}));
 await page.goto('https://reader.test/');
 // CSP のないページで、記事画面と同じ取り出し・後片付け・innerHTML への差し込みをする（CSP がなくても安全なことを確かめる）。
 const result=await page.evaluate(async({payloads,filler})=>{
  const reader=await import('/reader.js'),out=document.getElementById('out'),problems=[];
  const tags=new Set(['P','BR','H1','H2','H3','H4','H5','H6','UL','OL','LI','DL','DT','DD','BLOCKQUOTE','PRE','CODE','EM','STRONG','B','I','U','S','SUB','SUP','SMALL','MARK','A','IMG','PICTURE','FIGURE','FIGCAPTION','TABLE','THEAD','TBODY','TFOOT','TR','TH','TD','HR','DIV','SPAN','SECTION','ARTICLE']);
  const attrs=new Set(['href','src','alt','colspan','rowspan','target','rel','loading','referrerpolicy']);
  const check=(label,html)=>{
   out.innerHTML=html;reader.tidy(out,'題名');
   for(const el of out.querySelectorAll('*')){
    if(!tags.has(el.tagName)||el.namespaceURI!=='http://www.w3.org/1999/xhtml')problems.push(`${label}: <${el.tagName}>`);
    for(const a of el.attributes)if(!attrs.has(a.name)||(['href','src'].includes(a.name)&&!/^https?:\/\//.test(a.value)))problems.push(`${label}: ${el.tagName}[${a.name}=${a.value}]`);
   }
  };
  payloads.forEach((p,i)=>{
   check(`sanitize #${i}`,reader.sanitize(p,'https://blog.example/posts/a'));
   const r=reader.extract(`<!doctype html><html><head><title>題名</title></head><body><article><h1>題名</h1>${filler}<div>${p}</div>${filler}</article></body></html>`,'https://blog.example/posts/a');
   if(r)check(`extract #${i}`,r.content);else problems.push(`extract #${i}: 本文を取り出せない`);
  });
  await new Promise(r=>setTimeout(r,800));
  return {problems,xss:window.__xss||null};
 },{payloads,filler});
 await page.close();
 assert.deepEqual(result.problems,[]);
 assert.equal(result.xss,null);
});
test('A prefetched article opens in the reader under the page CSP, and offline taps explain themselves',async t=>{
 if(unavailable(t))return;
 const {context,page,errors}=await openApp();
 await stored(page,'https://blog.example/posts/prefetched');
 await page.click('text=先読みできる記事');
 await page.waitForSelector('#reader[open] #reader-content p');
 const reader=await page.evaluate(()=>({
  links:[...document.querySelectorAll('#reader-content a')].map(a=>a.getAttribute('href')),
  bad:[...document.querySelectorAll('#reader-content *')].filter(el=>[...el.attributes].some(a=>/^on|^style$|^srcset$/.test(a.name))||/^(SCRIPT|IFRAME|SVG|svg|FORM|OBJECT|EMBED|STYLE|BASE|META|LINK|INPUT)$/.test(el.tagName)).map(el=>el.outerHTML.slice(0,80)),
  xss:window.__xss||null,csp:window.__csp,
 }));
 assert.equal(reader.xss,null);assert.deepEqual(reader.bad,[]);
 // 相対リンクは記事のサイトのURLになる（アプリのURLにならない）。
 assert.ok(reader.links.includes('https://blog.example/docs/guide'),JSON.stringify(reader.links));
 assert.ok(reader.links.every(h=>h===null||/^https:\/\/blog\.example\//.test(h)),JSON.stringify(reader.links));
 assert.deepEqual(reader.csp,[],'アプリ自身の動作で CSP に止められるものがない');
 await page.click('#reader-close');await page.waitForFunction(()=>!document.getElementById('reader').open);
 // 電波がないとき、先読みしていない記事は開かずに知らせ、既読にもしない。先読みした記事は開ける。
 await context.setOffline(true);
 await page.click('text=先読みできない記事');
 await page.waitForSelector('#toast:has-text("電波がない")');
 assert.equal(page.url(),SITE);
 assert.equal(await page.locator('article.article',{hasText:'先読みできない記事'}).evaluate(el=>el.classList.contains('read')),false);
 await page.click('text=先読みできる記事');
 await page.waitForSelector('#reader[open] #reader-content p');
 assert.deepEqual(errors,[]);
 await context.close();
});
test('Broken saved data does not stop the list or the settings screen',async t=>{
 if(unavailable(t))return;
 const now=Date.now();
 const storage={
  'tech-feed-v1':JSON.stringify({read:'not a list',likes:[{u:'https://blog.example/posts/prefetched',t:now,f:[1,null,{},'source:テスト媒体'],title:'先読みできる記事',source:'テスト媒体'}],seen:[{u:'https://blog.example/old',t:now,f:[2,'term:古い'],n:9}],clicks:[{u:'https://blog.example/x',t:now,f:'oops'}],customSources:[{name:'壊れたサイト',feed:'https://broken.example/rss'}]}),
  'tech-feed-custom-v1':JSON.stringify({'https://broken.example/rss':{articles:'oops',fetchedAt:now,ok:true}}),
 };
 const {context,page,errors}=await openApp({storage});
 assert.equal(await page.locator('.article').count(),2);
 await page.click('#settings');
 await page.waitForSelector('#dialog[open] #sources label');
 assert.ok((await page.textContent('#interests')).length>0);
 assert.match(await page.textContent('#storage'),/このブラウザに保存されます/);
 assert.equal(await page.locator('#sources label',{hasText:'壊れたサイト'}).count(),1);
 // 検索は入力が止まってから絞り込む。
 await page.click('#close');
 await page.fill('#search','できない');
 await page.waitForFunction(()=>document.querySelectorAll('.article').length===1);
 assert.deepEqual(errors,[]);
 await context.close();
});
