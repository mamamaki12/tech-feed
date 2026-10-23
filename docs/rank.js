// おすすめ順: 開いた記事の傾向（配信元・分野・タイトル語）と新しさを掛け合わせて並べる。
// 興味: 開いた記事の特徴を半減期14日で減衰させて集計し、全記事での出現率と比べた「よく開く度合い」(lift)を使う。
// 履歴が少ないうちは、全体の出現率どおりの仮想クリックを足して平滑化する（Google Newsの個人化 Liu et al. 2010 と同じ考え方）。
// 新しさ: 半減期24時間の指数減衰。log(スコア) = 興味 - ln2 × 経過時間/24h なので「興味が e 倍 ≒ 約1.4日新しい」と同じ重み。
export const topicPatterns={'AI・生成AI':/AI|生成|機械学習|LLM|GPT|Claude|Gemini/i,'Web・開発':/開発|実装|JavaScript|TypeScript|React|Python|プログラ|CSS|HTML|コード|エンジニア/i,'セキュリティ':/セキュリティ|脆弱|攻撃|漏洩|認証|マルウェア/i,'クラウド・インフラ':/クラウド|AWS|Azure|サーバ|Docker|Kubernetes|インフラ|データベース|SRE/i,'ガジェット':/スマホ|iPhone|Android|PC|パソコン|デバイス|イヤホン|ガジェット|ディスプレイ/i};
const HOUR=3600000,DAY=24*HOUR;
export const config={interestHalfLifeDays:14,freshHalfLifeHours:24,smoothing:5,priorFloor:10,minTermWeight:1.5,maxClicks:500,readPenalty:Math.log(4),weights:{source:0.6,topic:0.8,term:0.6}};
const stopTerms=new Set(['こと','もの','ため','よう','これ','それ','発表','提供','開始','対応','公開','記事','方法','紹介','解説','について','ニュース','まとめ','今回','新た','可能','実現','向け','以上','以下','年月','月日','本日','今日','発売','the','and','for','with','new']);
const cache=new WeakMap();
export function features(a){
 if(cache.has(a))return cache.get(a);
 const f=new Set([`source:${a.source}`]);
 for(const [name,re] of Object.entries(topicPatterns))if(re.test(a.title))f.add(`topic:${name}`);
 for(const word of a.title.match(/[A-Za-z][A-Za-z0-9.+#-]*|[ァ-ヶー]{2,}|[一-龠々]{2,}/g)||[]){
  const term=word.replace(/[.-]+$/,'').toLowerCase();
  if(term.length>=2&&!stopTerms.has(term))f.add(`term:${term}`);
 }
 const list=[...f];cache.set(a,list);return list;
}
export function recordClick(clicks,a,now=Date.now()){
 if(clicks.some(c=>c.u===a.url))return clicks;
 return [...clicks,{u:a.url,t:now,f:features(a)}].slice(-config.maxClicks);
}
export function buildModel(articles,clicks,now=Date.now()){
 const prior=new Map(),weight=new Map();let total=0;
 for(const a of articles)for(const f of features(a))prior.set(f,(prior.get(f)||0)+1);
 // 出現回数に下駄を履かせ、1〜2件しかない珍しい語や配信元を1回開いただけで過大評価しないようにする。
 for(const [f,n] of prior)prior.set(f,(n+config.priorFloor)/(articles.length+config.priorFloor));
 for(const c of clicks){
  const d=0.5**(Math.max(0,now-c.t)/(config.interestHalfLifeDays*DAY));total+=d;
  for(const f of c.f)weight.set(f,(weight.get(f)||0)+d);
 }
 const a=config.smoothing;
 // 平滑化した「この特徴を含む記事を開く割合」÷「全記事に占める割合」の対数。履歴がなければ0。
 const lift=f=>{const p=prior.get(f)??config.priorFloor/(articles.length+config.priorFloor);return total?Math.log(((weight.get(f)||0)+a*p)/((total+a)*p)):0;};
 return {lift,weight,total,now};
}
const clamp=(x,lo,hi)=>Math.min(hi,Math.max(lo,x));
export function interest(model,a){
 const parts={source:[],topic:[],term:[]};
 for(const f of features(a)){const type=f.slice(0,f.indexOf(':'));parts[type].push([f,model.lift(f)]);}
 const contributions=[];
 const [source]=parts.source;if(source)contributions.push([source[0],config.weights.source*clamp(source[1],-1.5,2.5)]);
 // 分野は一番よく読む分野。タイトル語は2記事以上で開いた語だけを使い、未読の語で減点しないよう正の値の上位3語を平均する。
 const topic=parts.topic.sort((x,y)=>y[1]-x[1])[0];if(topic)contributions.push([topic[0],config.weights.topic*clamp(topic[1],-1.5,2.5)]);
 const terms=parts.term.filter(x=>x[1]>0&&(model.weight.get(x[0])||0)>=config.minTermWeight).sort((x,y)=>y[1]-x[1]).slice(0,3);
 if(terms.length)contributions.push([terms[0][0],config.weights.term*Math.min(2.5,terms.reduce((s,x)=>s+x[1],0)/terms.length)]);
 const value=contributions.reduce((s,x)=>s+x[1],0),top=contributions.sort((x,y)=>y[1]-x[1])[0];
 return {value,reason:top&&top[1]>=0.5?top[0]:null};
}
export function score(model,a,read=false){
 const hours=Math.max(0,model.now-Date.parse(a.published))/HOUR;
 return interest(model,a).value-Math.LN2*hours/config.freshHalfLifeHours-(read?config.readPenalty:0);
}
export function rankArticles(articles,model,readSet=new Set()){
 const scored=articles.map(a=>[a,score(model,a,readSet.has(a.url))]);
 return scored.sort((x,y)=>y[1]-x[1]).map(x=>x[0]);
}
export function featureLabel(f){
 const [type,...rest]=f.split(':'),name=rest.join(':');
 return type==='term'?`「${name}」`:name;
}
export function topInterests(model,count=8){
 return [...model.weight].filter(([,w])=>w>=config.minTermWeight).map(([f])=>[f,model.lift(f)]).filter(x=>x[1]>0).sort((x,y)=>y[1]-x[1]).slice(0,count);
}
