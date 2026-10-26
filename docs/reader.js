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
// 表示時の後片付け。Readability が拾ってしまうサイトの部品（共有ボタン・著者欄・関連記事・著作権表示・メニュー）や空の箱、
// 題名の重複、読み込めない画像・アイコン大の画像を取り除く。保存済みの記事にも効くよう、保存時ではなく表示時に行う。
const junkText=/^(share|シェア|ツイート|tweet|specialpr|pr|広告|スポンサーリンク|sponsored|advertisement|ブックマーク|はてなブックマーク|印刷|print)$/i;
const tailHeading=/^(この記事の著者|著者プロフィール|この記事を書いた人|関連記事|関連リンク|関連する記事|関連コンテンツ|あわせて読みたい|合わせて読みたい|おすすめ記事|人気記事|最新トピックス|specialインデックス|specialcontents|特別協賛|related( articles| posts)?)(pr)?$/i;
export function tidy(root,title){
 const text=el=>el.textContent.replace(/\s+/g,'').trim();
 const hasMedia=el=>el.matches('img,pre,table,hr')||el.querySelector('img,pre,table,hr');
 for(const el of [...root.querySelectorAll('p,div,li,h2,h3,h4,h5,h6')])if(root.contains(el)&&!hasMedia(el)&&junkText.test(text(el)))el.remove();
 // 見出し（または見出し代わりの短い段落）が「関連記事」などなら、そこから後ろはサイトの部品とみなす。
 for(const h of [...root.querySelectorAll('h2,h3,h4,h5,h6,p,div')]){
  if(!root.contains(h)||h.querySelector('p,div,img')||!tailHeading.test(text(h).replace(/^[・■●▼]/,'')))continue;
  let next=h.nextElementSibling;h.remove();while(next){const after=next.nextElementSibling;next.remove();next=after;}
 }
 for(const p of [...root.querySelectorAll('p,div,small')]){
  if(p.querySelector('p,div,img')||!/^(copyright|©|\(c\))/i.test(p.textContent.trim()))continue;
  const rest=p.textContent.trim().replace(/^.*?(all rights reserved\.?|無断転載[^。]*。)/i,'').trim();
  if(rest&&rest!==p.textContent.trim())p.textContent=rest;else if(p.textContent.length<300)p.remove();
 }
 // 本文より前にある、短いリンクだけが並ぶリストはサイトのメニューとみなす。
 const firstBody=[...root.querySelectorAll('p')].find(p=>text(p).length>=40);
 if(firstBody)for(const list of [...root.querySelectorAll('ul,ol')]){
  if(!(list.compareDocumentPosition(firstBody)&Node.DOCUMENT_POSITION_FOLLOWING))continue;
  const items=[...list.children];if(items.length>=3&&items.every(li=>text(li).length<=12&&li.querySelector('a')))list.remove();
 }
 const norm=s=>s.replace(/\s+/g,'');
 const firstHeading=root.querySelector('h1,h2');
 // 題名と同じ見出し（題名に「| サイト名」が付いているだけの違いも含む）が本文の先頭にあれば消す。
 const sameAsTitle=h=>{const t=norm(h.textContent),full=norm(title||'');return t===full||(t.length>=10&&full.startsWith(t));};
 if(firstHeading&&sameAsTitle(firstHeading)&&[...root.querySelectorAll('p')].filter(p=>p.compareDocumentPosition(firstHeading)&Node.DOCUMENT_POSITION_FOLLOWING).every(p=>!text(p)))firstHeading.remove();
 const emptyBox='p,div,li,ul,ol,figure,figcaption,section,span,a,h2,h3,h4,h5,h6,blockquote,strong,b,em';
 for(let changed=true;changed;){changed=false;for(const el of [...root.querySelectorAll(emptyBox)].reverse())if(!text(el)&&!el.querySelector('img,pre,table,hr,br')&&!el.matches('br')){el.remove();changed=true;}}
 for(const img of root.querySelectorAll('img')){
  // 画像を消したら、空になった入れ物（リンク・段落・図など）も一緒に消す。
  const drop=()=>{let box=img.parentElement;img.remove();while(box&&box!==root&&!text(box)&&!box.querySelector('img,pre,table,hr')){const up=box.parentElement;box.remove();box=up;}};
  img.addEventListener('error',drop,{once:true});
  img.addEventListener('load',()=>{if(img.naturalWidth<40&&img.naturalHeight<40)drop();},{once:true});
  if(img.complete)img.naturalWidth?(img.naturalWidth<40&&img.naturalHeight<40&&drop()):drop();
 }
}
function readability(html,url,strict){
 const doc=new DOMParser().parseFromString(html,'text/html');
 const base=doc.createElement('base');base.href=url;doc.head.prepend(base);
 const reader=new Readability(doc,{charThreshold:300});
 if(!strict)reader._flags&=~reader.FLAG_CLEAN_CONDITIONALLY;
 return reader.parse();
}
// Readability は、リンクや画像の多い箱ごと本文の段落を捨てることがある（GIGAZINEの冒頭の段落など）。
// 箱ごとの掃除をしない版で取り出し直し、そちらにしかない「本文らしい段落」だけを、元の並び順の位置に戻す。
// 本文らしい段落：40字以上・リンクの文字が1/4未満・リストの外・「題名｜サイト名」の形でない。戻す位置は、後ろにある本文の段落（40字以上）のうち最も近いものの前。後ろに本文が残っていない記事末尾の宣伝や関連記事は入れない。
const leafSelector='p,li,h1,h2,h3,h4,h5,h6,figcaption,blockquote,pre,table,dt,dd';
export function recoverParagraphs(strictHtml,looseHtml){
 const parse=h=>new DOMParser().parseFromString(`<body>${h}</body>`,'text/html').body;
 const norm=t=>t.replace(/\s+/g,'');
 const leaves=root=>[...root.querySelectorAll(leafSelector)].filter(e=>!e.parentElement?.closest(leafSelector));
 const strict=parse(strictHtml),loose=parse(looseHtml),strictText=norm(strict.textContent);
 const isBody=e=>e.tagName==='P'&&norm(e.textContent).length>=40&&!/^(copyright|©)/i.test(e.textContent.trim());
 const byText=new Map();for(const e of leaves(strict)){const t=norm(e.textContent);if(t&&isBody(e)&&!byText.has(t))byText.set(t,e);}
 const looseLeaves=leaves(loose);let added=0;
 looseLeaves.forEach((e,i)=>{
  const t=norm(e.textContent);
  if(e.tagName!=='P'||t.length<40||byText.has(t)||e.closest('ul,ol')||strictText.includes(t.slice(0,30))||/[|｜][^|｜]{2,30}$/.test(t))return;
  const linkText=[...e.querySelectorAll('a')].reduce((n,a)=>n+norm(a.textContent).length,0);
  if(linkText/t.length>=0.25)return;
  const anchor=looseLeaves.slice(i+1).map(x=>byText.get(norm(x.textContent))).find(Boolean);
  if(!anchor)return;
  const copy=e.cloneNode(true);for(const img of copy.querySelectorAll('img'))img.remove();
  anchor.before(copy);added++;
 });
 return added?strict.innerHTML:strictHtml;
}
export function extract(html,url){
 const article=readability(html,url,true);
 if(!article?.content||article.length<200)return null;
 const loose=readability(html,url,false);
 const content=loose?.content?recoverParagraphs(article.content,loose.content):article.content;
 return {title:article.title,siteName:article.siteName,byline:article.byline,content:sanitize(content,url)};
}
async function download(a){
 const res=await fetch(`${READER_PROXY}?url=${encodeURIComponent(a.url)}${a.feed?`&feed=${encodeURIComponent(a.feed)}`:''}`);
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
