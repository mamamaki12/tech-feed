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
