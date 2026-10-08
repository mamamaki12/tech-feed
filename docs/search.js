export function splitMatches(articles,query){
 const term=query.trim().toLowerCase();
 const primary=[],body=[];
 for(const a of articles){
  if(!term || `${a.title} ${a.source}`.toLowerCase().includes(term))primary.push(a);
  else if((a.body||'').toLowerCase().includes(term))body.push(a);
 }
 return {primary,body};
}
