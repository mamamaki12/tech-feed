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
