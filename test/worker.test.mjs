import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {handle,resetHosts} from '../worker/src/index.js';
const hostsUrl='https://mamamaki12.github.io/tech-feed/hosts.json';
function fakeFetch(pages){
 const calls=[];
 const fetcher=async(url)=>{calls.push(url);if(url===hostsUrl)return Response.json(['www.itmedia.co.jp']);const page=pages[url];return page?new Response(page.body,{status:page.status||200,headers:{'Content-Type':page.type||'text/html; charset=shift_jis'}}):new Response('missing',{status:404});};
 return {fetcher,calls};
}
const request=(url,origin='https://mamamaki12.github.io')=>new Request(`https://reader.example/?url=${encodeURIComponent(url)}`,{headers:{Origin:origin}});
beforeEach(resetHosts);
test('Relays an article page from a listed host with CORS for the site',async()=>{
 const {fetcher}=fakeFetch({'https://www.itmedia.co.jp/news/a.html':{body:'<html>記事</html>'}});
 const res=await handle(request('https://www.itmedia.co.jp/news/a.html'),fetcher);
 assert.equal(res.status,200);assert.equal(await res.text(),'<html>記事</html>');
 assert.equal(res.headers.get('Access-Control-Allow-Origin'),'https://mamamaki12.github.io');
 assert.equal(res.headers.get('Content-Type'),'text/html; charset=shift_jis');
});
test('Refuses hosts that are not in tech-feed and non-http URLs',async()=>{
 const {fetcher,calls}=fakeFetch({});
 assert.equal((await handle(request('https://evil.example/'),fetcher)).status,403);
 assert.equal((await handle(request('file:///etc/passwd'),fetcher)).status,400);
 assert.equal((await handle(new Request('https://reader.example/'),fetcher)).status,400);
 assert.ok(!calls.includes('https://evil.example/'));
});
test('Does not relay non-HTML or failed pages',async()=>{
 const {fetcher}=fakeFetch({'https://www.itmedia.co.jp/a.pdf':{body:'%PDF',type:'application/pdf'},'https://www.itmedia.co.jp/gone':{body:'',status:410}});
 assert.equal((await handle(request('https://www.itmedia.co.jp/a.pdf'),fetcher)).status,415);
 assert.equal((await handle(request('https://www.itmedia.co.jp/gone'),fetcher)).status,502);
});
test('Unknown origins get the site origin, not their own',async()=>{
 const {fetcher}=fakeFetch({'https://www.itmedia.co.jp/b':{body:'ok'}});
 const res=await handle(request('https://www.itmedia.co.jp/b','https://other.example'),fetcher);
 assert.equal(res.headers.get('Access-Control-Allow-Origin'),'https://mamamaki12.github.io');
});
const feedRequest=url=>new Request(`https://reader.example/?feed=${encodeURIComponent(url)}`,{headers:{Origin:'https://mamamaki12.github.io'}});
test('Feed mode returns RSS from any site but not ordinary pages',async()=>{
 const rss='<?xml version="1.0"?><rss><channel><title>ブログ</title></channel></rss>';
 const html='<html><head><link rel="alternate" type="application/rss+xml" title="RSS" href="/index.rdf"></head><body>本文</body></html>';
 const {fetcher}=fakeFetch({'https://blog.example/rss':{body:rss,type:'application/rss+xml'},'https://blog.example/':{body:html,type:'text/html'},'https://plain.example/':{body:'<html>ただのページ</html>',type:'text/html'}});
 const a=await (await handle(feedRequest('https://blog.example/rss'),fetcher)).json();
 assert.equal(a.type,'feed');assert.equal(a.text,rss);
 const b=await (await handle(feedRequest('https://blog.example/'),fetcher)).json();
 assert.deepEqual(b,{type:'links',feeds:[{url:'https://blog.example/index.rdf',title:'RSS'}]});
 const c=await (await handle(feedRequest('https://plain.example/'),fetcher)).json();
 assert.equal(c.type,'none');assert.ok(!JSON.stringify(c).includes('ただのページ'));
 assert.equal((await handle(feedRequest('http://192.168.0.1/'),fetcher)).status,403);
 assert.equal((await handle(feedRequest('http://localhost/'),fetcher)).status,403);
});
test('Pages from added sites are relayed only when listed in the given feed',async()=>{
 const rss='<?xml version="1.0"?><rss><channel><item><link>https://blog.example/posts/2026/hello?utm_source=rss&amp;x=1</link></item></channel></rss>';
 const {fetcher,calls}=fakeFetch({'https://blog.example/rss':{body:rss,type:'application/rss+xml'},'https://blog.example/posts/2026/hello':{body:'<html>記事</html>',type:'text/html'},'https://evil.example/':{body:'<html>他人</html>',type:'text/html'}});
 const req=(url,feed)=>new Request(`https://reader.example/?url=${encodeURIComponent(url)}&feed=${encodeURIComponent(feed)}`,{headers:{Origin:'https://mamamaki12.github.io'}});
 const ok=await handle(req('https://blog.example/posts/2026/hello','https://blog.example/rss'),fetcher);
 assert.equal(ok.status,200);assert.equal(await ok.text(),'<html>記事</html>');
 assert.equal((await handle(req('https://evil.example/','https://blog.example/rss'),fetcher)).status,403);
 assert.ok(!calls.includes('https://evil.example/'));
 assert.equal((await handle(new Request(`https://reader.example/?url=${encodeURIComponent('https://blog.example/posts/2026/hello')}`),fetcher)).status,403);
 assert.equal((await handle(req('http://192.168.0.1/posts/2026/hello','https://blog.example/rss'),fetcher)).status,403);
});
test('A page is not accepted just because a listed URL starts with it',async()=>{
 const rss='<?xml version="1.0"?><rss><channel><item><link>https://blog.example/posts/2026/hello</link></item></channel></rss>';
 const {fetcher}=fakeFetch({'https://blog.example/rss':{body:rss,type:'application/rss+xml'},'https://blog.example/':{body:'<html>top</html>',type:'text/html'},'https://blog.example/posts/2026/hello/':{body:'<html>記事</html>',type:'text/html'}});
 const req=(url)=>new Request(`https://reader.example/?url=${encodeURIComponent(url)}&feed=${encodeURIComponent('https://blog.example/rss')}`);
 assert.equal((await handle(req('https://blog.example/'),fetcher)).status,403);
 assert.equal((await handle(req('https://blog.example/posts/'),fetcher)).status,403);
 assert.equal((await handle(req('https://blog.example/posts/2026/hello/'),fetcher)).status,403);
});
// 自作のRSSに載せたページを中継させ、そのURLをブラウザで直接開かせても、中継のドメイン上でスクリプトやフォームが動かないこと。
test('Relayed pages are served inert so they cannot act as pages on the relay domain',async()=>{
 const rss='<?xml version="1.0"?><rss><channel><item><link>https://evil.example/login.html</link></item></channel></rss>';
 const {fetcher}=fakeFetch({'https://evil.example/rss':{body:rss,type:'application/rss+xml'},'https://evil.example/login.html':{body:'<form><input type=password></form><script>steal()</script>',type:'text/html'}});
 const res=await handle(new Request(`https://reader.example/?url=${encodeURIComponent('https://evil.example/login.html')}&feed=${encodeURIComponent('https://evil.example/rss')}`),fetcher);
 assert.equal(res.status,200);
 assert.match(res.headers.get('Content-Security-Policy'),/sandbox/);assert.match(res.headers.get('Content-Security-Policy'),/default-src 'none'/);
 assert.equal(res.headers.get('X-Content-Type-Options'),'nosniff');
 for(const r of [await handle(request('https://evil.example/'),fetcher),await handle(feedRequest('https://evil.example/rss'),fetcher)])assert.match(r.headers.get('Content-Security-Policy'),/sandbox/);
});
test('Only real HTML content types are relayed',async()=>{
 const {fetcher}=fakeFetch({'https://www.itmedia.co.jp/x.svg':{body:'<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>',type:'image/svg+xml; x=text/html'},'https://www.itmedia.co.jp/x.html':{body:'<html>ok</html>',type:'TEXT/HTML;charset=UTF-8'},'https://www.itmedia.co.jp/x.xhtml':{body:'<html/>',type:'application/xhtml+xml'}});
 assert.equal((await handle(request('https://www.itmedia.co.jp/x.svg'),fetcher)).status,415);
 assert.equal((await handle(request('https://www.itmedia.co.jp/x.html'),fetcher)).status,200);
 assert.equal((await handle(request('https://www.itmedia.co.jp/x.xhtml'),fetcher)).status,200);
});
test('The size limit holds even without Content-Length',async()=>{
 const stream=size=>{let sent=0;return new ReadableStream({pull(c){if(sent>=size)return c.close();const chunk=new Uint8Array(Math.min(1<<20,size-sent)).fill(60);sent+=chunk.length;c.enqueue(chunk);}});};
 const fetcher=async url=>{
  if(url===hostsUrl)return Response.json(['www.itmedia.co.jp']);
  if(url.endsWith('/feed'))return new Response(stream(4_000_000),{headers:{'Content-Type':'application/rss+xml'}});
  return new Response(stream(url.endsWith('/big')?6_000_000:200_000),{headers:{'Content-Type':'text/html'}});
 };
 assert.equal((await handle(request('https://www.itmedia.co.jp/big'),fetcher)).status,413);
 const ok=await handle(request('https://www.itmedia.co.jp/small'),fetcher);
 assert.equal(ok.status,200);assert.equal((await ok.arrayBuffer()).byteLength,200_000);
 const feed=await handle(feedRequest('https://blog.example/feed'),fetcher);
 assert.equal(feed.status,413);assert.equal((await feed.json()).type,'error');
});
test('Failures are not kept in the browser cache',async()=>{
 const {fetcher}=fakeFetch({});
 const down=await handle(feedRequest('https://down.example/feed'),async()=>{throw new Error('offline');});
 assert.equal(down.status,502);assert.equal(down.headers.get('Cache-Control'),'no-store');
 assert.equal((await handle(feedRequest('https://blog.example/missing'),fetcher)).headers.get('Cache-Control'),'no-store');
 assert.equal((await handle(request('https://www.itmedia.co.jp/missing'),fetcher)).headers.get('Cache-Control'),'no-store');
});
test('Local network names and redirects into them are refused',async()=>{
 const {fetcher,calls}=fakeFetch({});
 for(const url of ['http://localhost./feed','http://router/feed','http://nas.home.arpa/feed','http://app.localhost/feed','http://printer.lan/','http://[::1]/','http://2130706433/']){
  const res=await handle(feedRequest(url),fetcher);
  assert.equal(res.status,403,url);assert.equal((await res.json()).message,'not allowed');
 }
 assert.ok(!calls.some(u=>u!==hostsUrl),'nothing was fetched');
 // 公開サイトから自分のネットワーク内へ転送されたら、中身を返さない。
 const redirected=async(url)=>{const res=new Response('<rss><channel><item><link>http://10.0.0.5/admin</link></item></channel></rss>',{headers:{'Content-Type':'application/rss+xml'}});Object.defineProperty(res,'url',{value:'http://10.0.0.5/admin'});return url===hostsUrl?Response.json(['www.itmedia.co.jp']):res;};
 assert.equal((await handle(feedRequest('https://blog.example/feed'),redirected)).status,403);
 assert.equal((await handle(request('https://www.itmedia.co.jp/go'),redirected)).status,403);
});
