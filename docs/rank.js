// おすすめ順: 開いた記事の傾向（配信元・分野・タイトル語）と新しさを掛け合わせて並べる。
// 興味: 開いた記事の特徴を半減期14日で減衰させて集計し、全記事での出現率と比べた「よく開く度合い」(lift)を使う。
// 履歴が少ないうちは、全体の出現率どおりの仮想クリックを足して平滑化する（Google Newsの個人化 Liu et al. 2010 と同じ考え方）。
// ハート: 自分で付けた明示的な好みなので、1件を開いた記事3件分として数え、半減期も60日と長くする。
// 履歴が少ないとき: 好みの効きを (履歴量/(履歴量+20))² 倍に弱め（3件で約2%、10件で約11%、30件で約36%）、数件開いただけで一覧全体が1つのジャンルに偏らないようにする。
// 新着枠: 4件に1件は好みと関係なく新着順から入れ、履歴が増えても他のジャンルの記事が目に入るようにする。
// 見たのに開かなかった記事: 画面に1秒以上表示された記事を「表示した」と記録し、開かれた割合（クリック率）を特徴ごとに出す。
//   よく表示されるのに開かれない配信元・分野・語（表示5件分以上、語は3件分以上で、クリック率が平均の半分未満）だけを、半分を下回った分だけ下げる。
//   少し低い程度で下げると、表示されたことのない記事ばかりが浮いてしまうため。好きな分野は表示も多いので、表示回数ではなく割合で見る
//   （上にあるほど見られやすい偏りを避ける。Joachims らの Click > Skip Above の考え方を、表示された記事全体に広げたもの）。
//   下げ幅は最大 ln2（＝1日古い記事と同じ）まで。表示の記録が少ないうちは (表示件数/(表示件数+30))² 倍に弱める。
//   記事そのものも、開かれずに表示された回数（30分以上あけて1回）ごとに 0.3 ずつ下げ、最大で既読と同じ ln4 まで。
// 興味なし: 押した記事の特徴を、ハートと同じく1件3件分・半減期60日で集計し、全記事より多く含まれる配信元・分野・語を下げる。
//   1件押しただけで一覧が変わりすぎないよう (量/(量+60))² 倍に弱める。記事が多く上位40件は数時間分しかないため、小さな減点でも効く。
//   実データでは、ガジェット記事を1件で上位に残る同種の記事6件中4件、3件で4件中1件、5件で0件になった。下げ幅は最大 ln4（2日古い記事と同じ）まで。押した記事自体は一覧から外す。
// 新しさ: 半減期24時間の指数減衰。log(スコア) = 興味 - ln2 × 経過時間/24h なので「興味が e 倍 ≒ 約1.4日新しい」と同じ重み。
export const topicPatterns={'AI・生成AI':/AI|生成|機械学習|LLM|GPT|Claude|Gemini/i,'Web・開発':/開発|実装|JavaScript|TypeScript|React|Python|プログラ|CSS|HTML|コード|エンジニア/i,'セキュリティ':/セキュリティ|脆弱|攻撃|漏洩|認証|マルウェア/i,'クラウド・インフラ':/クラウド|AWS|Azure|サーバ|Docker|Kubernetes|インフラ|データベース|SRE/i,'ガジェット':/スマホ|iPhone|Android|PC|パソコン|デバイス|イヤホン|ガジェット|ディスプレイ/i};
const HOUR=3600000,DAY=24*HOUR;
export const config={interestHalfLifeDays:14,freshHalfLifeHours:24,smoothing:5,priorFloor:10,minTermWeight:1.5,maxClicks:500,likeWeight:3,likeHalfLifeDays:60,readPenalty:Math.log(4),confidenceClicks:20,freshSlotEvery:4,maxSeen:1500,seenGapMinutes:30,seenHalfLifeDays:14,ctrSmoothing:5,seenConfidence:30,minSeenWeight:5,minSeenTermWeight:3,maxSkipPenalty:Math.LN2,skipArticleStep:0.3,maxSkipArticle:Math.log(4),dislikeWeight:3,dislikeHalfLifeDays:60,dislikeConfidenceWeight:60,maxDislikePenalty:Math.log(4),weights:{source:0.6,topic:0.8,term:0.6}};
const stopTerms=new Set(['こと','もの','ため','よう','これ','それ','発表','提供','開始','対応','公開','記事','方法','紹介','解説','について','ニュース','まとめ','今回','新た','可能','実現','向け','以上','以下','年月','月日','本日','今日','発売','問題','the','and','for','with','new']);
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
// 表示の記録。同じ記事は30分以内に何度見えても1回と数える。
export function recordSeen(seen,a,now=Date.now()){
 const old=seen.find(s=>s.u===a.url);
 if(old&&now-old.t<config.seenGapMinutes*60000)return seen;
 const entry={u:a.url,t:now,f:features(a),n:(old?.n||0)+1};
 return [...seen.filter(s=>s!==old),entry].slice(-config.maxSeen);
}
export function toggleLike(likes,a,now=Date.now()){
 if(likes.some(l=>l.u===a.url))return likes.filter(l=>l.u!==a.url);
 // 記事は30日で一覧から消えるので、ハート一覧を表示できるよう題名なども一緒に保存する。
 return [...likes,{u:a.url,title:a.title,source:a.source,published:a.published,t:now,f:features(a)}];
}
export function buildModel(articles,clicks,now=Date.now(),likes=[],seen=[],dislikes=[]){
 const prior=new Map(),weight=new Map();let total=0;
 for(const a of articles)for(const f of features(a))prior.set(f,(prior.get(f)||0)+1);
 // 出現回数に下駄を履かせ、1〜2件しかない珍しい語や配信元を1回開いただけで過大評価しないようにする。
 for(const [f,n] of prior)prior.set(f,(n+config.priorFloor)/(articles.length+config.priorFloor));
 const signals=[...clicks.map(c=>[c,1,config.interestHalfLifeDays]),...likes.map(l=>[l,config.likeWeight,config.likeHalfLifeDays])];
 for(const [c,w,halfLife] of signals){
  const d=w*0.5**(Math.max(0,now-c.t)/(halfLife*DAY));total+=d;
  for(const f of c.f)weight.set(f,(weight.get(f)||0)+d);
 }
 const a=config.smoothing;
 // 平滑化した「この特徴を含む記事を開く割合」÷「全記事に占める割合」の対数。履歴がなければ0。
 const lift=f=>{const p=prior.get(f)??config.priorFloor/(articles.length+config.priorFloor);return total?Math.log(((weight.get(f)||0)+a*p)/((total+a)*p)):0;};
 // 表示した記事のうち開いた割合。特徴ごとの割合は、全体の割合に向けて ctrSmoothing 件分だけ寄せて平滑化する。
 const dislikeWeight=new Map();let dislikeTotal=0;
 for(const x of dislikes){const d=config.dislikeWeight*0.5**(Math.max(0,now-x.t)/(config.dislikeHalfLifeDays*DAY));dislikeTotal+=d;for(const f of x.f)dislikeWeight.set(f,(dislikeWeight.get(f)||0)+d);}
 const dislikeLift=f=>{const p=prior.get(f)??config.priorFloor/(articles.length+config.priorFloor);return dislikeTotal?Math.log(((dislikeWeight.get(f)||0)+a*p)/((dislikeTotal+a)*p)):0;};
 const opened=new Set([...clicks.map(c=>c.u),...likes.map(l=>l.u)]),seenWeight=new Map(),openWeight=new Map(),skipCount=new Map();
 let shown=0,shownOpened=0;
 for(const s of seen){
  const d=0.5**(Math.max(0,now-s.t)/(config.seenHalfLifeDays*DAY)),hit=opened.has(s.u);
  shown+=d;if(hit)shownOpened+=d;else skipCount.set(s.u,s.n);
  for(const f of s.f){seenWeight.set(f,(seenWeight.get(f)||0)+d);if(hit)openWeight.set(f,(openWeight.get(f)||0)+d);}
 }
 const baseRate=(shownOpened+1)/(shown+2),k=config.ctrSmoothing;
 const skipLift=f=>{const w=seenWeight.get(f);return w?Math.log((((openWeight.get(f)||0)+k*baseRate)/(w+k))/baseRate):0;};
 return {lift,weight,total,now,confidence:(total/(total+config.confidenceClicks))**2,skipLift,seenWeight,skipCount,skipConfidence:(shown/(shown+config.seenConfidence))**2,dislikeLift,dislikeWeight,dislikeConfidence:(dislikeTotal/(dislikeTotal+config.dislikeConfidenceWeight))**2};
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
 const value=model.confidence*contributions.reduce((s,x)=>s+x[1],0),top=contributions.sort((x,y)=>y[1]-x[1])[0];
 return {value:value+skipPenalty(model,a)+dislikePenalty(model,a),reason:top&&top[1]>=0.5?top[0]:null};
}
// 開かれにくい特徴による減点（0以下）。配信元・分野（平均）・語（低い3つの平均）で見る。
export function skipPenalty(model,a){
 if(!model.skipConfidence)return 0;
 const parts={source:[],topic:[],term:[]};
 for(const f of features(a)){
  const type=f.slice(0,f.indexOf(':'));
  if((model.seenWeight.get(f)||0)>=(type==='term'?config.minSeenTermWeight:config.minSeenWeight))parts[type].push(Math.min(0,model.skipLift(f)+Math.LN2));
  else if(type!=='term')parts[type].push(0);
 }
 const mean=xs=>xs.length?xs.reduce((s,x)=>s+x,0)/xs.length:0;
 const terms=parts.term.sort((x,y)=>x-y).slice(0,3);
 const raw=config.weights.source*clamp(mean(parts.source),-2.5,0)+config.weights.topic*clamp(mean(parts.topic),-2.5,0)+config.weights.term*clamp(mean(terms),-2.5,0);
 return Math.max(-config.maxSkipPenalty,model.skipConfidence*raw);
}
// 興味なしによる減点（0以下）。配信元・一番当てはまる分野・語（上位3つの平均）で、興味なしに多く含まれるほど下げる。
export function dislikePenalty(model,a){
 if(!model.dislikeConfidence)return 0;
 const parts={source:[],topic:[],term:[]};
 for(const f of features(a)){const type=f.slice(0,f.indexOf(':'));if(type!=='term'||(model.dislikeWeight.get(f)||0)>=config.minTermWeight)parts[type].push(Math.max(0,model.dislikeLift(f)));}
 const terms=parts.term.sort((x,y)=>y-x).slice(0,3);
 const raw=config.weights.source*Math.min(2.5,parts.source[0]||0)+config.weights.topic*Math.min(2.5,Math.max(0,...parts.topic))+config.weights.term*Math.min(2.5,terms.length?terms.reduce((s,x)=>s+x,0)/terms.length:0);
 return raw?-Math.min(config.maxDislikePenalty,model.dislikeConfidence*raw):0;
}
export function topDislikes(model,count=5){
 if(!model.dislikeConfidence)return [];
 // 1記事だけに出てくる珍しい語ではなく、2記事以上に共通するものを出す。
 return [...model.dislikeWeight].filter(([,w])=>w>=config.dislikeWeight*1.5).map(([f])=>[f,model.dislikeLift(f)]).filter(x=>x[1]>0.5).sort((x,y)=>y[1]-x[1]).slice(0,count);
}
const articleSkip=(model,a)=>Math.min(config.maxSkipArticle,config.skipArticleStep*(model.skipCount?.get(a.url)||0));
export function score(model,a,read=false){
 const hours=Math.max(0,model.now-Date.parse(a.published))/HOUR;
 return interest(model,a).value-Math.LN2*hours/config.freshHalfLifeHours-(read?config.readPenalty:0)-articleSkip(model,a);
}
export function rankArticles(articles,model,readSet=new Set()){
 const ranked=articles.map(a=>[a,score(model,a,readSet.has(a.url))]).sort((x,y)=>y[1]-x[1]).map(x=>x[0]);
 if(!model.total&&!model.skipCount?.size)return ranked;
 // 新着枠: 未読を優先した新着順から、まだ入っていない記事を一定間隔で差し込む。
 const fresh=articles.map(a=>[a,Date.parse(a.published)-((readSet.has(a.url)?config.readPenalty:0)+articleSkip(model,a))/Math.LN2*config.freshHalfLifeHours*HOUR]).sort((x,y)=>y[1]-x[1]).map(x=>x[0]);
 const result=[],used=new Set();let i=0,j=0;
 while(result.length<articles.length){
  const fromFresh=(result.length+1)%config.freshSlotEvery===0;
  let a;
  if(fromFresh){while(j<fresh.length&&used.has(fresh[j]))j++;a=fresh[j];}
  if(!a){while(used.has(ranked[i]))i++;a=ranked[i];}
  used.add(a);result.push(a);
 }
 return result;
}
export function featureLabel(f){
 const [type,...rest]=f.split(':'),name=rest.join(':');
 return type==='term'?`「${name}」`:name;
}
// 表示は多いのに開かれにくい特徴（設定画面に出す）。
export function topSkips(model,count=5){
 if(!model.skipConfidence)return [];
 return [...model.seenWeight].filter(([f,w])=>w>=(f.startsWith('term:')?config.minSeenTermWeight:config.minSeenWeight)).map(([f])=>[f,model.skipLift(f)]).filter(x=>x[1]<-Math.LN2).sort((x,y)=>x[1]-y[1]).slice(0,count);
}
export function topInterests(model,count=8){
 return [...model.weight].filter(([,w])=>w>=config.minTermWeight).map(([f])=>[f,model.lift(f)]).filter(x=>x[1]>0).sort((x,y)=>y[1]-x[1]).slice(0,count);
}
