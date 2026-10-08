import { XMLParser } from 'fast-xml-parser';
const parser = new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_'});
const list = x => x ? (Array.isArray(x) ? x : [x]) : [];
const value = x => typeof x === 'object' ? x?.['#text'] || '' : x || '';
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
   return [{url,title:displayTitle,source:publisher || source.name,published:published.toISOString()}];
  } catch {return [];}
 });
}
