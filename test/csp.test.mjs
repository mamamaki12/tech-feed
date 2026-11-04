import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {READER_PROXY} from '../docs/config.js';
// index.html の Content-Security-Policy。記事画面に他サイトの本文を入れるので、万一それに仕掛けがあってもスクリプトとして動かないようにしている。
const html=await readFile(new URL('../docs/index.html',import.meta.url),'utf8');
const csp=html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1]||'';
const directive=name=>csp.split(';').map(d=>d.trim().split(/\s+/)).find(([n])=>n===name)?.slice(1)||null;
test('The page has a CSP that blocks inline and injected scripts',()=>{
 assert.ok(csp,'index.html に Content-Security-Policy の meta がない');
 assert.ok(html.indexOf('Content-Security-Policy')<html.indexOf('<script'),'CSP はどの script よりも前に置く');
 const scripts=directive('script-src');
 assert.ok(scripts&&scripts.includes("'self'"));
 for(const bad of ["'unsafe-inline'","'unsafe-eval'",'*','https:','data:'])assert.ok(!scripts.includes(bad),`script-src に ${bad} を入れない`);
 assert.deepEqual(directive('object-src'),["'none'"]);
 assert.ok(!/\son[a-z]+=/i.test(html),'onclick="…" のような属性は CSP で止まるので使わない');
});
test('Every inline script in index.html is allowed by its hash',()=>{
 for(const [,code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)){
  const hash=`'sha256-${createHash('sha256').update(code,'utf8').digest('base64')}'`;
  assert.ok(directive('script-src').includes(hash),`index.html の <script> を書き換えたら、CSP の script-src のハッシュを ${hash} にする`);
 }
});
test('The CSP keeps the reader, the relay and the fonts working',()=>{
 // 記事画面は取り出した本文の中で <base> を使ってリンクや画像のURLを記事のサイトに合わせている。base-uri を 'self' や 'none' にするとそれが効かなくなる。
 assert.ok(!/(^|;)\s*base-uri\s+'(self|none)'\s*(;|$)/.test(csp),"base-uri を 'self' や 'none' にしない");
 const connect=directive('connect-src')||directive('default-src');
 assert.ok(connect.includes('https:')||connect.includes(new URL(READER_PROXY).origin),'config.js の中継に接続できるようにする');
 assert.ok(directive('img-src').includes('https:'),'記事の画像を表示できるようにする');
 assert.ok(directive('style-src').includes('https://fonts.googleapis.com')&&directive('font-src').includes('https://fonts.gstatic.com'));
 // 記事の本文を取り出すとき（DOMParser）にも CSP が効く。style 属性を止めると「display:none」の隠れた部分を見分けられず、記事に混ざってしまう。
 assert.ok(directive('style-src').includes("'unsafe-inline'"),"style-src には 'unsafe-inline' を残す");
});
