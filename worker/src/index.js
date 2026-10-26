// tech-feed の記事ページを取ってくるだけの中継。ブラウザは他サイトのページを直接読めない（CORS）ため、ここで代わりに取得する。
// 本文の取り出し・広告の除去はブラウザ側（docs/reader.js）で行う。無料プランのCPU上限（1回10ms）に収めるため、ここでは解析しない。
const SITE='https://mamamaki12.github.io';
const ORIGINS=[SITE,'http://127.0.0.1:4173','http://localhost:4173'];
const HOSTS_URL=`${SITE}/tech-feed/hosts.json`;
const MAX_BYTES=5_000_000;
const UA='Mozilla/5.0 (compatible; TechFeedReader/1.0; +https://mamamaki12.github.io/tech-feed/)';
let hosts=null,hostsAt=0;
async function allowedHosts(fetcher){
 // tech-feed に載っている記事のサイトだけを取得できるようにして、何でも取れる中継として悪用されないようにする。
 if(!hosts||Date.now()-hostsAt>600_000){
  try{const res=await fetcher(HOSTS_URL,{cf:{cacheTtl:600}});if(res.ok){hosts=new Set(await res.json());hostsAt=Date.now();}}catch{}
 }
 return hosts||new Set();
}
export function resetHosts(){hosts=null;hostsAt=0;}
// ユーザーが追加したサイトのRSS取得（?feed=URL）。どのサイトでもよいが、返すのはRSS/Atomの本文だけにして、普通のページを中継しないようにする。
// サイトのページURLが渡されたら、ページ内の <link rel="alternate" type="application/rss+xml"> とよくある場所（/feed など）から記事一覧の場所を探して返す。
const FEED_MAX_BYTES=3_000_000,FEED_PATHS=['/feed','/rss','/feed/','/index.xml','/atom.xml','/rss.xml','/feed.xml','/rss2.xml'];
const isFeedText=text=>/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<\?xml-stylesheet[^>]*>\s*)?<(rss|feed|rdf:RDF)\b/i.test(text.slice(0,2000));
function privateHost(host){return host==='localhost'||host.endsWith('.local')||host.endsWith('.internal')||/^\[|^\d+\.\d+\.\d+\.\d+$/.test(host);}
async function readText(res){
 if(Number(res.headers.get('Content-Length'))>FEED_MAX_BYTES)return null;
 const buf=await res.arrayBuffer();if(buf.byteLength>FEED_MAX_BYTES)return null;
 const type=res.headers.get('Content-Type')||'',head=new TextDecoder('latin1').decode(buf.slice(0,2000));
 const charset=type.match(/charset=["']?([\w-]+)/i)?.[1]||head.match(/encoding=["']([\w-]+)/i)?.[1]||head.match(/charset=["']?([\w-]+)/i)?.[1]||'utf-8';
 try{return new TextDecoder(charset).decode(buf);}catch{return new TextDecoder().decode(buf);}
}
async function handleFeed(target,cors,fetcher){
 const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=900'}});
 const get=url=>fetcher(url,{headers:{'User-Agent':UA,'Accept':'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8'},redirect:'follow',cf:{cacheTtl:900,cacheEverything:true}});
 let res;try{res=await get(target.href);}catch{return json(502,{type:'error',message:'fetch failed'});}
 if(!res.ok)return json(502,{type:'error',message:`upstream ${res.status}`});
 const text=await readText(res);if(text==null)return json(413,{type:'error',message:'too large'});
 const finalUrl=res.url||target.href;
 if(isFeedText(text))return json(200,{type:'feed',url:finalUrl,text});
 const feeds=[];
 for(const tag of text.match(/<link\b[^>]*>/gi)||[]){
  const attr=name=>tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`,'i'))?.[1];
  if(!/alternate/i.test(attr('rel')||'')||!/(rss|atom)\+xml/i.test(attr('type')||''))continue;
  try{feeds.push({url:new URL(attr('href').replace(/&amp;/g,'&'),finalUrl).href,title:attr('title')||''});}catch{}
 }
 if(!feeds.length)for(const path of FEED_PATHS){
  try{const r=await get(new URL(path,finalUrl).href);if(r.ok){const t=await readText(r);if(t&&isFeedText(t)){feeds.push({url:r.url||new URL(path,finalUrl).href,title:''});break;}}}catch{}
 }
 return json(200,feeds.length?{type:'links',feeds}:{type:'none'});
}
// ユーザーが追加したサイトの記事ページ（?url=記事&feed=そのRSS）。RSSをこちらで取り直し、記事のURLが本当に載っているときだけ取得する。
// 自分で用意したRSSに好きなURLを書けば取得させられるので完全には防げないが、何でも取れる中継よりは悪用の手間が増える。
async function listedInFeed(article,feed,fetcher){
 if(privateHost(feed.hostname)||!['http:','https:'].includes(feed.protocol))return false;
 let res;try{res=await fetcher(feed.href,{headers:{'User-Agent':UA,'Accept':'application/rss+xml, application/atom+xml, application/xml, text/xml'},redirect:'follow',cf:{cacheTtl:900,cacheEverything:true}});}catch{return false;}
 if(!res.ok)return false;
 const text=await readText(res);if(!text||!isFeedText(text))return false;
 const body=text.replace(/&amp;/g,'&');
 // アプリ側で utm_ などを外しているので、完全一致がなければクエリを除いた形でも探す（短すぎるパスは除く）。
 // URLの途中で一致しただけ（トップページが各記事URLの先頭に含まれる、など）では認めず、URLの終わりまで一致したときだけ認める。
 const listed=url=>new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=/?(["\'<\\s?#&]|$))').test(body);
 return listed(article.href)||(article.pathname.length>=8&&listed(article.origin+article.pathname));
}
function reply(status,body,cors,extra={}){return new Response(body,{status,headers:{...cors,'Content-Type':'text/plain; charset=utf-8',...extra}});}
export async function handle(request,fetcher=fetch){
 const origin=request.headers.get('Origin');
 const cors={'Access-Control-Allow-Origin':ORIGINS.includes(origin)?origin:SITE,'Access-Control-Expose-Headers':'X-Final-URL','Vary':'Origin'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET'}});
 if(request.method!=='GET')return reply(405,'GET only',cors);
 const params=new URL(request.url).searchParams,isFeed=params.has('feed')&&!params.has('url');
 let target;
 try{target=new URL(params.get(isFeed?'feed':'url'));}catch{return reply(400,'url is required',cors);}
 if(!['http:','https:'].includes(target.protocol))return reply(400,'http(s) only',cors);
 if(isFeed)return privateHost(target.hostname)?reply(403,'not allowed',cors):handleFeed(target,cors,fetcher);
 const allowed=await allowedHosts(fetcher);
 if(!allowed.has(target.hostname)){
  let feed=null;try{feed=params.has('feed')?new URL(params.get('feed')):null;}catch{}
  if(!feed||privateHost(target.hostname)||!(await listedInFeed(target,feed,fetcher)))return reply(403,'not a tech-feed article host',cors);
 }
 let res;
 try{res=await fetcher(target.href,{headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml','Accept-Language':'ja,en;q=0.8'},redirect:'follow',cf:{cacheTtl:3600,cacheEverything:true}});}
 catch{return reply(502,'fetch failed',cors);}
 const type=res.headers.get('Content-Type')||'';
 if(!res.ok)return reply(502,`upstream ${res.status}`,cors);
 if(!/text\/html|application\/xhtml/.test(type))return reply(415,'not html',cors);
 if(Number(res.headers.get('Content-Length'))>MAX_BYTES)return reply(413,'too large',cors);
 return new Response(res.body,{status:200,headers:{...cors,'Content-Type':type,'Cache-Control':'public, max-age=3600','X-Final-URL':res.url||target.href}});
}
export default {fetch:request=>handle(request)};
