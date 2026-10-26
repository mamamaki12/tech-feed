import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCustomFeed,feedTitle} from '../docs/feeds.js';
test('RSS 2.0 items with CDATA and entities',()=>{
 const xml=`<?xml version="1.0"?><rss><channel><title>私の &amp; ブログ</title><item><title><![CDATA[新機能 <b>&</b> 改善]]></title><link>https://blog.example/a?utm_source=rss#top</link><pubDate>Thu, 08 Oct 2026 00:00:00 GMT</pubDate><description>&lt;p&gt;本文&lt;/p&gt;</description></item><item><title>日付なし</title><link>https://blog.example/b</link></item></channel></rss>`;
 assert.equal(feedTitle(xml),'私の & ブログ');
 const a=parseCustomFeed(xml,'私のブログ','https://blog.example/rss');
 assert.equal(a.length,1);assert.equal(a[0].title,'新機能 & 改善');assert.equal(a[0].url,'https://blog.example/a');assert.equal(a[0].published,'2026-10-08T00:00:00.000Z');assert.equal(a[0].body,'本文');assert.equal(a[0].custom,true);
});
test('Atom picks the alternate link and resolves relative URLs',()=>{
 const xml=`<feed xmlns="http://www.w3.org/2005/Atom"><title>Atomのサイト</title><entry><title>記事</title><link rel="self" href="/api/1"/><link rel="alternate" href="/posts/1"/><updated>2026-10-08T01:00:00Z</updated><summary>要約</summary></entry></feed>`;
 const [a]=parseCustomFeed(xml,'Atom','https://atom.example/feed.xml');
 assert.equal(a.url,'https://atom.example/posts/1');assert.equal(a.body,'要約');assert.equal(feedTitle(xml),'Atomのサイト');
});
test('RDF uses dc:date and rejects unsafe links',()=>{
 const xml=`<rdf:RDF><channel><title>RDF</title></channel><item rdf:about="https://rdf.example/1"><title>記事1</title><link>https://rdf.example/1</link><dc:date>2026-10-08T09:00:00+09:00</dc:date></item><item rdf:about="javascript:alert(1)"><title>悪い</title><link>javascript:alert(1)</link><dc:date>2026-10-08T09:00:00+09:00</dc:date></item></rdf:RDF>`;
 const a=parseCustomFeed(xml,'RDF','https://rdf.example/index.rdf');
 assert.equal(a.length,1);assert.equal(a[0].published,'2026-10-08T00:00:00.000Z');
});
