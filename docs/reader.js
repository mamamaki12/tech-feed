// 電波が悪いところでも読めるように、読みそうな記事の本文を先に取得してブラウザ内（IndexedDB）に保存しておく。
// ページの取得は Cloudflare Worker（worker/）が中継し、本文の取り出し・広告の除去はここで Readability（Firefoxのリーダービューと同じ処理）を使って行う。
import {Readability} from './vendor/Readability.js';
import {READER_PROXY} from './config.js';
const DAY=86400000,KEEP_DAYS=14,MAX_ENTRIES=300,CONCURRENCY=2;
export const enabled=Boolean(READER_PROXY)&&typeof indexedDB!=='undefined';
const ready=new Set(),unreadable=new Set(),inflight=new Set(),queue=[];let dbPromise,running=0;
function db(){
 return dbPromise??=new Promise((resolve,reject)=>{const req=indexedDB.open('tech-feed-reader',1);req.onupgradeneeded=()=>req.result.createObjectStore('articles',{keyPath:'url'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
}
async function store(mode,fn){
 const d=await db();
 return new Promise((resolve,reject)=>{const t=d.transaction('articles',mode),req=fn(t.objectStore('articles'));t.oncomplete=()=>resolve(req?.result);t.onerror=()=>reject(t.error);});
}
// 古いものと多すぎる分を消し、どの記事が読めるかを覚えておく（クリック時にすぐ判定するため）。
export async function init(){
 if(!enabled)return;
 try{
  const all=await store('readonly',s=>s.getAll()),cutoff=Date.now()-KEEP_DAYS*DAY;
  const keep=all.filter(x=>x.savedAt>=cutoff).sort((x,y)=>y.savedAt-x.savedAt).slice(0,MAX_ENTRIES),keepUrls=new Set(keep.map(x=>x.url));
  const drop=all.filter(x=>!keepUrls.has(x.url));
  if(drop.length)await store('readwrite',s=>{for(const x of drop)s.delete(x.url);});
  for(const x of keep)(x.failed?unreadable:ready).add(x.url);
 }catch{}
}
export const has=url=>ready.has(url);
export const get=url=>store('readonly',s=>s.get(url));
function decode(buffer,type){
 const charset=text=>text?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1];
 const label=charset(type)||charset(new TextDecoder('latin1').decode(buffer.slice(0,4096)))||'utf-8';
 try{return new TextDecoder(label).decode(buffer);}catch{return new TextDecoder().decode(buffer);}
}
const allowedTags=new Set(['P','BR','H1','H2','H3','H4','H5','H6','UL','OL','LI','DL','DT','DD','BLOCKQUOTE','PRE','CODE','EM','STRONG','B','I','U','S','SUB','SUP','SMALL','MARK','A','IMG','PICTURE','FIGURE','FIGCAPTION','TABLE','THEAD','TBODY','TFOOT','TR','TH','TD','HR','DIV','SPAN','SECTION','ARTICLE']);
const droppedTags=new Set(['SCRIPT','STYLE','IFRAME','FRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','SELECT','TEXTAREA','NOSCRIPT','SVG','MATH','TEMPLATE','LINK','META','BASE','VIDEO','AUDIO','SOURCE','TRACK','CANVAS','DIALOG']);
function safeUrl(value,base){try{const url=new URL(value,base);return ['http:','https:'].includes(url.protocol)?url.href:null;}catch{return null;}}
// 取り出した本文は他サイトのHTMLなので、決まったタグと属性（リンク先・画像・表の結合）だけを残す。
export function sanitize(html,base){
 const doc=new DOMParser().parseFromString(`<body>${html}</body>`,'text/html');
 const clean=node=>{
  for(const child of [...node.childNodes]){
   if(child.nodeType===3)continue;
   if(child.nodeType!==1){child.remove();continue;}
   const tag=child.tagName.toUpperCase();
   if(droppedTags.has(tag)){child.remove();continue;}
   clean(child);
   if(!allowedTags.has(tag)){child.replaceWith(...child.childNodes);continue;}
   for(const {name} of [...child.attributes]){
    const keep=(tag==='A'&&name==='href')||(tag==='IMG'&&(name==='src'||name==='alt'))||((tag==='TD'||tag==='TH')&&(name==='colspan'||name==='rowspan'));
    if(!keep)child.removeAttribute(name);
   }
   if(tag==='A'){const href=safeUrl(child.getAttribute('href'),base);if(href){child.setAttribute('href',href);child.setAttribute('target','_blank');child.setAttribute('rel','noopener noreferrer');}else child.removeAttribute('href');}
   if(tag==='IMG'){const src=safeUrl(child.getAttribute('src'),base);if(!src){child.remove();continue;}child.setAttribute('src',src);child.setAttribute('loading','lazy');child.setAttribute('referrerpolicy','no-referrer');}
  }
 };
 clean(doc.body);
 return doc.body.innerHTML;
}
export function extract(html,url){
 const doc=new DOMParser().parseFromString(html,'text/html');
 const base=doc.createElement('base');base.href=url;doc.head.prepend(base);
 const article=new Readability(doc,{charThreshold:300}).parse();
 if(!article?.content||article.length<200)return null;
 return {title:article.title,siteName:article.siteName,byline:article.byline,content:sanitize(article.content,url)};
}
async function download(a){
 const res=await fetch(`${READER_PROXY}?url=${encodeURIComponent(a.url)}`);
 // 有料記事・対象外のサイトなどは何度も取りに行かないよう「読めない」と記録する。通信エラーは次の機会に再挑戦する。
 if(!res.ok){if(res.status!==429&&res.status<500)await store('readwrite',s=>s.put({url:a.url,failed:true,savedAt:Date.now()}));unreadable.add(a.url);return;}
 const result=extract(decode(await res.arrayBuffer(),res.headers.get('Content-Type')),res.headers.get('X-Final-URL')||a.url);
 if(!result){await store('readwrite',s=>s.put({url:a.url,failed:true,savedAt:Date.now()}));unreadable.add(a.url);return;}
 await store('readwrite',s=>s.put({url:a.url,...result,title:result.title||a.title,savedAt:Date.now()}));
 ready.add(a.url);
}
function pump(){
 while(running<CONCURRENCY&&queue.length&&navigator.onLine){
  const a=queue.shift();running++;inflight.add(a.url);
  download(a).catch(()=>{}).finally(()=>{running--;inflight.delete(a.url);pump();});
 }
}
// 先読みする記事を入れ替える。データ節約モードやオフラインのときは何もしない。
export function prefetch(articles){
 if(!enabled||navigator.connection?.saveData)return;
 queue.length=0;
 for(const a of articles){
  if(ready.has(a.url)||unreadable.has(a.url)||inflight.has(a.url))continue;
  try{if(!safeUrl(a.url)||new URL(a.url).hostname==='news.google.com')continue;}catch{continue;}
  queue.push(a);
 }
 pump();
}
addEventListener('online',pump);
