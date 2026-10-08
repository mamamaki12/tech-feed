import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseFeed} from './feed.mjs';
const sources=JSON.parse(await readFile(new URL('../sources.json',import.meta.url)));
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
const articles=[...new Map([...previous.articles,...fresh].map(a=>[a.url,a])).values()].filter(a=>Date.parse(a.published)>=cutoff && Date.parse(a.published)<=Date.now()+86400000).sort((a,b)=>Date.parse(b.published)-Date.parse(a.published)).slice(0,5000);
await mkdir(new URL('../docs/',import.meta.url),{recursive:true});
await writeFile(path,JSON.stringify({updatedAt:new Date().toISOString(),sources:statuses,articles}));
console.log(`${articles.length} articles; ${statuses.filter(s=>s.ok).length}/${sources.length} sources OK`);
for(const s of statuses.filter(s=>!s.ok)) console.log(`${s.name}: ${s.error}`);
