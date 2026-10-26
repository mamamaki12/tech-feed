import {test} from 'node:test';
import assert from 'node:assert/strict';
import {features,recordClick,recordSeen,toggleLike,buildModel,interest,score,skipPenalty,dislikePenalty,rankArticles} from '../docs/rank.js';
const now=Date.parse('2026-10-23T00:00:00Z'),hoursAgo=h=>new Date(now-h*3600000).toISOString();
const article=(title,source,h)=>({title,source,url:`https://example.com/${encodeURIComponent(title)}`,published:hoursAgo(h)});
test('Title features include source, topic and terms without stop words',()=>{
 const f=features(article('Claude Codeの新機能を発表','Zenn',1));
 assert.ok(f.includes('source:Zenn'));assert.ok(f.includes('topic:AI・生成AI'));assert.ok(f.includes('term:claude'));assert.ok(!f.includes('term:発表'));
});
test('Without history the order is newest first',()=>{
 const items=[article('古い記事','A',30),article('新しい記事','B',1)];
 assert.deepEqual(rankArticles(items,buildModel(items,[],now)).map(a=>a.source),['B','A']);
});
test('With enough history, frequently opened topics outrank slightly newer articles, but not much older ones',()=>{
 const past=Array.from({length:40},(_,i)=>article(`Rustの所有権 ${i}`,'Zenn',100+i)),gadget=article('新型スマホ発売','PC Watch',1);
 const rustFresh=article('Rust 2027の新機能','Zenn',6),rustOld=article('Rustの非同期処理','Zenn',24*10);
 let clicks=[];for(const a of past)clicks=recordClick(clicks,a,now-3600000);
 const articles=[...past,gadget,rustFresh,rustOld,...Array.from({length:30},(_,i)=>article(`クラウド記事 ${i}`,'AWS',200))];
 const model=buildModel(articles,clicks,now);
 assert.ok(interest(model,rustFresh).value>interest(model,gadget).value);
 const order=rankArticles([gadget,rustOld,rustFresh],model);
 assert.deepEqual(order,[rustFresh,gadget,rustOld]);
});
test('Opening the same article twice counts once',()=>{
 const a=article('記事','A',1);assert.equal(recordClick(recordClick([],a,now),a,now).length,1);
});
test('Read articles are pushed down',()=>{
 const a=article('記事A','A',1),b=article('記事B','A',2),model=buildModel([a,b],[],now);
 assert.deepEqual(rankArticles([a,b],model,new Set([a.url])),[b,a]);
});
test('A heart toggles and keeps enough to list the article later',()=>{
 const a=article('Claudeの記事','Zenn',1);const likes=toggleLike([],a,now);
 assert.equal(likes.length,1);assert.equal(likes[0].title,a.title);assert.equal(likes[0].source,'Zenn');
 assert.deepEqual(toggleLike(likes,a,now),[]);
});
test('A heart counts more than opening an article',()=>{
 const zenn=article('Rustの記事','Zenn',50),qiita=article('Goの記事','Qiita',50);
 const articles=[zenn,qiita,...Array.from({length:30},(_,i)=>article(`その他 ${i}`,'AWS',200))];
 const model=buildModel(articles,recordClick([],qiita,now),now,toggleLike([],zenn,now));
 const fresh=[article('新しいZenn記事','Zenn',3),article('新しいQiita記事','Qiita',3)];
 assert.ok(interest(model,fresh[0]).value>interest(model,fresh[1]).value);
});
test('A few opens barely change the order',()=>{
 const past=[1,2,3].map(i=>article(`Rustの所有権 ${i}`,'Zenn',100+i)),gadget=article('新型スマホ発売','PC Watch',1),rust=article('Rust 2027の新機能','Zenn',3);
 let clicks=[];for(const a of past)clicks=recordClick(clicks,a,now-3600000);
 const articles=[...past,gadget,rust,...Array.from({length:30},(_,i)=>article(`クラウド記事 ${i}`,'AWS',200))];
 assert.deepEqual(rankArticles([rust,gadget],buildModel(articles,clicks,now)),[gadget,rust]);
});
test('Every fourth slot comes from the newest articles',()=>{
 const liked=Array.from({length:40},(_,i)=>article(`Rust ${i}`,'Zenn',1+i*0.1)),fresh=article('新着ニュース','PC Watch',0.5);
 let clicks=[];for(const a of liked.slice(20))clicks=recordClick(clicks,a,now);
 const others=Array.from({length:40},(_,i)=>article(`その他 ${i}`,'AWS',300)),model=buildModel([...liked,fresh,...others],clicks,now);
 assert.ok(score(model,liked[0])>score(model,fresh));
 const order=rankArticles([...liked.slice(0,20),fresh],model);
 assert.equal(order.indexOf(fresh),3);
});
test('Seeing an article again within 30 minutes counts once',()=>{
 const a=article('記事','A',1);let seen=recordSeen([],a,now);seen=recordSeen(seen,a,now+10*60000);assert.equal(seen[0].n,1);
 seen=recordSeen(seen,a,now+40*60000);assert.equal(seen.length,1);assert.equal(seen[0].n,2);
});
test('An article shown repeatedly without a tap moves down, up to the read penalty',()=>{
 const a=article('記事A','A',1),b=article('記事B','A',1.2);let seen=[];
 for(let i=0;i<3;i++)seen=recordSeen(seen,a,now-i*3600000);
 const model=buildModel([a,b],[],now,[],seen);
 assert.deepEqual(rankArticles([a,b],model),[b,a]);
 for(let i=3;i<20;i++)seen=recordSeen(seen,a,now-i*3600000);
 const capped=buildModel([a,b],[],now,[],seen);
 assert.ok(score(capped,b)-score(capped,a)<=Math.log(4)+0.01);
});
test('Often shown but rarely opened sources are lowered by share, not by how often they are shown',()=>{
 const shown=[];let seen=[],clicks=[];
 // A は40件表示して20件開く（好きで表示も多い）、B は40件表示して0件
 for(let i=0;i<40;i++){const x=article(`A記事${i}`,'A',30+i),y=article(`B記事${i}`,'B',30+i);shown.push(x,y);seen=recordSeen(recordSeen(seen,x,now-3600000),y,now-3600000);if(i%2===0)clicks=recordClick(clicks,x,now-3600000);}
 const model=buildModel(shown,clicks,now,[],seen),freshA=article('新しいA','A',1),freshB=article('新しいB','B',1);
 assert.ok(skipPenalty(model,freshB)<-0.1);
 assert.equal(skipPenalty(model,freshA),0);
 assert.ok(skipPenalty(model,freshB)>=-Math.LN2);
});
test('Without enough records the skip penalty stays small',()=>{
 const x=article('B記事','B',5);const model=buildModel([x],[],now,[],recordSeen([],x,now));
 assert.ok(skipPenalty(model,article('新しいB','B',1))>-0.01);
});
test('Not interested lowers similar articles, gently at first and up to two days',()=>{
 const gadgets=Array.from({length:6},(_,i)=>article(`新型スマホ ${i}`,'PC Watch',20+i)),others=Array.from({length:30},(_,i)=>article(`クラウド記事 ${i}`,'AWS',200));
 const articles=[...gadgets,...others],freshGadget=article('新型スマホの話','PC Watch',1),freshOther=article('別の話題','Zenn',1);
 const one=buildModel(articles,[],now,[],[],toggleLike([],gadgets[0],now));
 assert.ok(dislikePenalty(one,freshGadget)<0&&dislikePenalty(one,freshGadget)>-0.3);
 let many=[];for(const g of gadgets)many=toggleLike(many,g,now);
 const strong=buildModel(articles,[],now,[],[],many);
 assert.ok(dislikePenalty(strong,freshGadget)<dislikePenalty(one,freshGadget));
 assert.ok(dislikePenalty(strong,freshGadget)>=-Math.log(4));
 assert.equal(dislikePenalty(strong,freshOther),0);
});
