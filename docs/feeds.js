// ユーザーが追加したサイトのRSS/RDF/Atomを読む。ブラウザでもテストでも動くよう、DOMParserを使わず文字列から取り出す。
const decodeEntities=s=>s.replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code<=0x10ffff?String.fromCodePoint(code):' ';})
 .replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;|&#39;/g,"'").replace(/&amp;/g,'&');
// CDATAの中はそのまま、外は文字参照を戻す。
function inner(raw){return raw.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/).map(part=>part.startsWith('<![CDATA[')?part.slice(9,-3):decodeEntities(part)).join('');}
const plain=html=>html.replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
function tag(block,names){
 for(const name of names){const m=block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`,'i'));if(m)return inner(m[1]);}
 return '';
}
const attr=(tagText,name)=>{const v=tagText.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`,'i'))?.[1];return v==null?null:decodeEntities(v);};
export function normalizeUrl(raw,base){
 const u=new URL(raw.trim(),base);
 if(!['https:','http:'].includes(u.protocol))throw new Error('Invalid protocol');
 u.hash='';for(const key of [...u.searchParams.keys()])if(key.startsWith('utm_'))u.searchParams.delete(key);
 return u.href;
}
function atomLink(block){
 const links=block.match(/<link\b[^>]*>/gi)||[];
 const alt=links.find(l=>/rel\s*=\s*["']alternate["']/i.test(l))||links.find(l=>!/\brel\s*=/i.test(l));
 return alt?attr(alt,'href'):null;
}
export function feedTitle(text){
 const head=text.split(/<(item|entry)\b/i)[0];
 return plain(tag(head,['title']));
}
export function parseCustomFeed(text,source,base){
 const blocks=text.match(/<(item|entry)\b[\s\S]*?<\/(item|entry)>/gi)||[];
 return blocks.flatMap(block=>{
  try{
   const isAtom=/^<entry\b/i.test(block);
   const rawLink=isAtom?atomLink(block):(tag(block,['link']).trim()||attr(block.match(/<item\b[^>]*>/i)[0],'rdf:about')||tag(block,['guid']));
   const url=normalizeUrl(rawLink,base);
   const title=plain(tag(block,['title']));
   const published=new Date(tag(block,['pubDate','dc:date','published','updated']).trim());
   if(!title||!Number.isFinite(published.getTime()))return [];
   const body=plain(tag(block,['content:encoded','content','description','summary'])).slice(0,2000);
   return [{url,title,source,published:published.toISOString(),body,custom:true}];
  }catch{return [];}
 });
}
