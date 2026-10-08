import { XMLParser } from 'fast-xml-parser';
const parser = new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_'});
const list = x => x ? (Array.isArray(x) ? x : [x]) : [];
const value = x => typeof x === 'object' ? x?.['#text'] || '' : x || '';
export function feedText(raw){
 return String(value(raw)).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code<=0x10ffff?String.fromCodePoint(code):' ';}).replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
}
export function normalizeUrl(raw) {
 const u = new URL(raw);
 if (!['https:','http:'].includes(u.protocol)) throw new Error('Invalid protocol');
 u.hash=''; for(const key of [...u.searchParams.keys()]) if(key.startsWith('utm_')) u.searchParams.delete(key);
 return u.href;
}
export function parseFeed(xml, source) {
 const doc=parser.parse(xml); const items=doc.rss?.channel?.item || doc['rdf:RDF']?.item || doc.feed?.entry;
 if(!items) throw new Error('No supported feed entries');
 return list(items).flatMap(item=>{
  try {
   const links=list(item.link); const link=links.find(x=>x?.['@_rel']==='alternate') || links.find(x=>!x?.['@_rel']);
   const url=normalizeUrl(typeof link==='object' ? link['@_href'] || value(link) : link);
   const title=String(value(item.title)).replace(/<[^>]*>/g,'').trim();
   const published=new Date(value(item.published || item.pubDate || item['dc:date'] || item.updated));
   if(!title || !Number.isFinite(published.getTime())) return [];
   const publisher=source.name.startsWith('Googleニュース：') ? String(value(item.source)).trim() : '';
   const suffix=' - '+publisher;
   const displayTitle=publisher && title.endsWith(suffix) ? title.slice(0,-suffix.length).trim() : title;
   const body=source.name.startsWith('Googleニュース：')?'':feedText(item['content:encoded'] || item.content || item.description || item.summary).slice(0,50000);
   return [{url,title:displayTitle,source:publisher || source.name,published:published.toISOString(),body}];
  } catch {return [];}
 });
}
