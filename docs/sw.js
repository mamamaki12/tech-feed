// 電波がないときでもアプリの画面と前回取得した記事一覧を開けるよう、このサイトのファイルを保存しておく。
// まず通信して最新を取り、つながらない・遅いとき（3秒）は保存しておいたものを使う。
const CACHE='tech-feed-v1',TIMEOUT=3000;
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET')return;
 const own=url.origin===location.origin,font=/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
 if(!own&&!font)return;
 event.respondWith(networkFirst(request,event));
});
async function networkFirst(request,event){
 const cache=await caches.open(CACHE);
 const network=fetch(request).then(res=>{if(res.ok||res.type==='opaque')event.waitUntil(cache.put(request,res.clone()));return res;});
 event.waitUntil(network.catch(()=>{}));
 const fallback=async()=>(await cache.match(request,{ignoreSearch:true}))||(request.mode==='navigate'?await cache.match('./',{ignoreSearch:true}):undefined);
 try{
  return await Promise.race([network,new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),TIMEOUT))]);
 }catch{
  // 遅いだけなら保存分を先に返し、保存分がなければ通信の完了を待つ。
  return (await fallback())||network.catch(()=>Response.error());
 }
}
