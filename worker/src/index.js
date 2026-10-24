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
function reply(status,body,cors,extra={}){return new Response(body,{status,headers:{...cors,'Content-Type':'text/plain; charset=utf-8',...extra}});}
export async function handle(request,fetcher=fetch){
 const origin=request.headers.get('Origin');
 const cors={'Access-Control-Allow-Origin':ORIGINS.includes(origin)?origin:SITE,'Access-Control-Expose-Headers':'X-Final-URL','Vary':'Origin'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET'}});
 if(request.method!=='GET')return reply(405,'GET only',cors);
 let target;
 try{target=new URL(new URL(request.url).searchParams.get('url'));}catch{return reply(400,'url is required',cors);}
 if(!['http:','https:'].includes(target.protocol))return reply(400,'http(s) only',cors);
 const allowed=await allowedHosts(fetcher);
 if(!allowed.has(target.hostname))return reply(403,'not a tech-feed article host',cors);
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
