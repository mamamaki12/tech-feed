import {test} from 'node:test';
import assert from 'node:assert/strict';
import {features,recordClick,toggleLike,buildModel,interest,rankArticles} from '../docs/rank.js';
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
test('Frequently opened topics outrank slightly newer articles, but not much older ones',()=>{
 const past=[1,2,3,4,5].map(i=>article(`Rustの所有権 ${i}`,'Zenn',100+i)),gadget=article('新型スマホ発売','PC Watch',1);
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
