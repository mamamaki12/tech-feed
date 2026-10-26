// 電波がないときでもアプリの画面と前回取得した記事一覧を開けるよう、このサイトのファイルを保存しておく。
// まず通信して最新を取り、つながらない・遅いとき（3秒）は保存しておいたものを使う。
const CACHE='tech-feed-v1',TIMEOUT=3000;
// 版番号つきのファイル（app.js?v=21 など）は中身が変わらないので、同じ番号の保存分があればそれを使う。
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET')return;
 const own=url.origin===location.origin,font=/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
 if(!own&&!font)return;
 event.respondWith(url.searchParams.has('v')?versioned(request,event):networkFirst(request,event));
});
async function versioned(request,event){
 const cache=await caches.open(CACHE),hit=await cache.match(request);
 if(hit)return hit;
 try{const res=await fetch(request);if(res.ok)event.waitUntil(cache.put(request,res.clone()));return res;}
 catch{return (await cache.match(request,{ignoreSearch:true}))||Response.error();}
}
async function networkFirst(request,event){
 const cache=await caches.open(CACHE);
 const network=fetch(request).then(res=>{if(res.ok||res.type==='opaque')event.waitUntil(cache.put(request,res.clone()));return res;});
 event.waitUntil(network.catch(()=>{}));
 // 番号違いの古いファイルが混ざらないよう、まず同じURLの保存分を探す。
 const fallback=async()=>(await cache.match(request))||(await cache.match(request,{ignoreSearch:true}))||(request.mode==='navigate'?await cache.match('./',{ignoreSearch:true}):undefined);
 try{
  return await Promise.race([network,new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),TIMEOUT))]);
 }catch{
  // 遅いだけなら保存分を先に返し、保存分がなければ通信の完了を待つ。
  return (await fallback())||network.catch(()=>Response.error());
 }
}
