import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseFeed,normalizeUrl} from '../scripts/feed.mjs';
test('RSS normalizes dates and tracking links',()=>{const a=parseFeed('<rss><channel><item><title>日本語 &amp; RSS</title><link>https://example.com/a?utm_source=rss</link><pubDate>Thu, 08 Oct 2026 00:00:00 GMT</pubDate></item></channel></rss>',{name:'test'});assert.equal(a[0].title,'日本語 & RSS');assert.equal(a[0].url,'https://example.com/a');assert.equal(a[0].published,'2026-10-08T00:00:00.000Z');});
test('Atom selects alternate link',()=>{const a=parseFeed('<feed><entry><title>開発</title><link rel="self" href="https://example.com/api"/><link rel="alternate" href="https://example.com/article"/><updated>2026-10-08T01:00:00Z</updated></entry></feed>',{name:'test'});assert.equal(a[0].url,'https://example.com/article');});
test('Rejects unsafe URLs and invalid dates',()=>{assert.throws(()=>normalizeUrl('javascript:alert(1)'));assert.deepEqual(parseFeed('<rss><channel><item><title>開発</title><link>https://example.com</link><pubDate>invalid</pubDate></item></channel></rss>',{name:'test'}),[]);});
