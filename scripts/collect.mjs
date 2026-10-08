import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseFeed} from './feed.mjs';
const sources=JSON.parse(await readFile(new URL('../sources.json',import.meta.url)));
// One-time backfill supplements the short history available in normal RSS feeds.
const backfill=process.argv.indexOf('--backfill');
if(backfill!==-1){
 const query=process.argv[backfill+1];
 if(!query || query.startsWith('--'))throw new Error('--backfill requires a search term');
 sources.push({name:'Googleニュース：過去記事補充',url:`https://news.google.com/rss/search?q=${encodeURIComponent(query+' when:30d')}&hl=ja&gl=JP&ceid=JP:ja`,backfill:true});
}
const path=new URL('../docs/articles.json',import.meta.url);
let previous={articles:[]}; try{previous=JSON.parse(await readFile(path));}catch{}
const statuses=[]; const fresh=[];
for(let i=0;i<sources.length;i+=5) await Promise.all(sources.slice(i,i+5).map(async source=>{
 try {
  const res=await fetch(source.url,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'TechFeed/1.0 RSS Reader','Accept':'application/rss+xml, application/atom+xml, application/xml, text/xml'}});
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const articles=parseFeed(await res.text(),source).filter(a=>/[ぁ-んァ-ヶ一-龠]/u.test(a.title));
  if(!articles.length) throw new Error('日本語の記事が取得できません');
  fresh.push(...articles); statuses.push({...source,ok:true,count:articles.length});
 } catch(error){statuses.push({...source,ok:false,error:error.message});}
}));
if(!fresh.length) throw new Error('全配信元の取得に失敗しました。前回のデータを保持します。');
const cutoff=Date.now()-30*86400000;
const byUrl=[...new Map([...previous.articles,...fresh].map(a=>[a.url,a])).values()];
const byTitle=new Map();
for(const a of byUrl){
 if(a.url.startsWith('https://news.google.com/') && a.title.endsWith(' - '+a.source))a.title=a.title.slice(0,-(' - '+a.source).length).trim();
 const key=a.title.replace(/\s/g,'');
 const existing=byTitle.get(key);
 if(!existing || existing.url.startsWith('https://news.google.com/'))byTitle.set(key,a);
}
const articles=[...byTitle.values()].filter(a=>Date.parse(a.published)>=cutoff && Date.parse(a.published)<=Date.now()+86400000).sort((a,b)=>Date.parse(b.published)-Date.parse(a.published)).slice(0,20000);
await mkdir(new URL('../docs/',import.meta.url),{recursive:true});
await writeFile(path,JSON.stringify({updatedAt:new Date().toISOString(),sources:statuses.filter(s=>!s.backfill),articles}));
console.log(`${articles.length} articles; ${statuses.filter(s=>s.ok).length}/${sources.length} sources OK`);
for(const s of statuses.filter(s=>!s.ok)) console.log(`${s.name}: ${s.error}`);
