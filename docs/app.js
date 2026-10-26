import {splitMatches} from './search.js';
import * as reader from './reader.js';
import {topicPatterns as patterns,recordClick,recordSeen,toggleLike,buildModel,rankArticles,topInterests,topSkips,featureLabel} from './rank.js';
const $=id=>document.getElementById(id);
const readerStyles=[['note','note風'],['tech','技術記事風（Zenn・Qiita風）']],themes=[['light','オフ'],['dark','オン'],['auto','端末に合わせる']];
let state={read:[],saved:[],paid:[],blocked:[],excluded:'',clicks:[],likes:[],seen:[],sort:'recommended',readerStyle:'note',theme:'light'},data,limit=40,storageOK=true;
try{const s=JSON.parse(localStorage.getItem('tech-feed-v1'));if(s){for(const k of ['read','saved','paid','blocked'])if(Array.isArray(s[k]))state[k]=s[k].filter(x=>typeof x==='string');if(typeof s.excluded==='string')state.excluded=s.excluded;if(Array.isArray(s.clicks))state.clicks=s.clicks.filter(c=>c&&typeof c.u==='string'&&Number.isFinite(c.t)&&Array.isArray(c.f));if(Array.isArray(s.likes))state.likes=s.likes.filter(l=>l&&typeof l.u==='string'&&typeof l.title==='string'&&typeof l.source==='string'&&Number.isFinite(l.t)&&Array.isArray(l.f));if(Array.isArray(s.seen))state.seen=s.seen.filter(x=>x&&typeof x.u==='string'&&Number.isFinite(x.t)&&Array.isArray(x.f)&&Number.isFinite(x.n));if(['recommended','newest'].includes(s.sort))state.sort=s.sort;if(readerStyles.some(([k])=>k===s.readerStyle))state.readerStyle=s.readerStyle;if(themes.some(([k])=>k===s.theme))state.theme=s.theme;}}catch{storageOK=false;}
function toast(message){$('toast').textContent=message;$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',3500);}
// 表示の記録はスクロールのたびに増えるので、まとめて2秒後に保存する。
function persistSoon(){clearTimeout(persistSoon.timer);persistSoon.timer=setTimeout(persist,2000);}
addEventListener('pagehide',()=>{if(persistSoon.timer){clearTimeout(persistSoon.timer);persist();}});
// おすすめ順の一覧で、記事の6割以上が1秒以上見えていたら「表示した」と記録する（検索中・ハート一覧などは記録しない）。
const seenTimers=new WeakMap();
const seenObserver=new IntersectionObserver(entries=>{
 for(const entry of entries){
  const el=entry.target;
  if(entry.isIntersecting){if(!seenTimers.has(el))seenTimers.set(el,setTimeout(()=>{seenTimers.delete(el);const a=el.article;if(a&&!state.read.includes(a.url)){state.seen=recordSeen(state.seen,a);persistSoon();}},1000));}
  else{clearTimeout(seenTimers.get(el));seenTimers.delete(el);}
 }
},{threshold:0.6});
function persist(){try{localStorage.setItem('tech-feed-v1',JSON.stringify(state));}catch{storageOK=false;toast('保存できません。設定はこのページを開いている間だけ有効です。');}}
function button(label,fn,active=false){const b=document.createElement('button');b.textContent=label;b.classList.toggle('active',active);b.addEventListener('click',fn);return b;}
const readerReady=reader.init();
// 表示中の未読の上位12件と「あとで読む」を先読みする。スクロールや絞り込みのたびに取り直さないよう少し待つ。
function schedulePrefetch(items){
 clearTimeout(schedulePrefetch.timer);
 schedulePrefetch.timer=setTimeout(()=>readerReady.then(()=>{const read=new Set(state.read),saved=new Set(state.saved);reader.prefetch([...items.filter(a=>!read.has(a.url)).slice(0,12),...data.articles.filter(a=>saved.has(a.url)).slice(0,30)]);}),1500);
}
// ダークモードと記事の見た目。ダークは「端末に合わせる」なら端末の設定が変わったときにも追従する。
const darkQuery=matchMedia('(prefers-color-scheme: dark)');
function applyDisplay(){
 const dark=state.theme==='dark'||(state.theme==='auto'&&darkQuery.matches);
 document.documentElement.dataset.theme=dark?'dark':'light';
 document.querySelector('meta[name=theme-color]').content=dark?'#121614':'#23332c';
 $('reader').dataset.style=state.readerStyle;
}
darkQuery.addEventListener('change',applyDisplay);applyDisplay();
// 設定画面と記事画面の「Aa」で同じ選択肢を出す。
function displayControls(container){
 container.replaceChildren();
 for(const [key,title,options] of [['readerStyle','記事の見た目',readerStyles],['theme','ダークモード',themes]]){
  const heading=document.createElement('h3'),choices=document.createElement('div');heading.textContent=title;choices.className='choices';
  for(const [value,label] of options){
   const item=document.createElement('label'),input=document.createElement('input');
   input.type='radio';input.name=`${container.id}-${key}`;input.value=value;input.checked=state[key]===value;
   input.onchange=()=>{
    state[key]=value;persist();applyDisplay();
   };
   item.append(input,label);choices.append(item);
  }
  container.append(heading,choices);
 }
}
$('reader-style').onclick=()=>{displayControls($('display-quick'));$('display-dialog').showModal();};
$('display-close').onclick=()=>$('display-dialog').close();
async function openReader(a){
 const entry=await reader.get(a.url).catch(()=>null);
 if(!entry?.content){location.href=a.url;return;}
 $('reader-title').textContent=entry.title||a.title;
 $('reader-meta').textContent=`${a.source} · ${new Date(a.published).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}`;
 $('reader-content').innerHTML=entry.content;$('reader-original').href=a.url;
 reader.tidy($('reader-content'),entry.title||a.title);
 // 読了時間は日本語を1分500字として目安を出す。目次は見出しが2つ以上あるときだけ作る。
 $('reader-time').textContent=`約${Math.max(1,Math.round($('reader-content').textContent.replace(/\s+/g,'').length/500))}分で読めます`;
 // 目次は大見出し（h2）が2つ以上あればそれだけ、なければ小見出しも使い、長くなりすぎないよう15項目までにする。
 const h2=[...$('reader-content').querySelectorAll('h2')].filter(h=>h.textContent.trim());
 const headings=(h2.length>=2?h2:[...$('reader-content').querySelectorAll('h2,h3')].filter(h=>h.textContent.trim())).slice(0,15);
 $('reader-toc').replaceChildren();
 if(headings.length>=2){
  const label=document.createElement('b');label.textContent='目次';$('reader-toc').append(label);
  for(const h of headings){const b=document.createElement('button');b.textContent=h.textContent.trim();if(h.tagName==='H3')b.className='sub';b.onclick=()=>h.scrollIntoView({behavior:'smooth',block:'start',inline:'start'});$('reader-toc').append(b);}
 }
 applyDisplay();$('reader').showModal();$('reader').scrollTop=0;
 // iPhone の Safari は開いた直後に先頭のボタンを選択して枠を出すので、本文に選択を移す。
 $('reader').querySelector('article').focus({preventScroll:true});history.pushState({reader:true},'');
}
// スマホの「戻る」で一覧に戻れるよう、開いたときに履歴を1つ積む。
addEventListener('popstate',()=>{if($('reader').open)$('reader').close();});
$('reader-close').onclick=()=>{if(history.state?.reader)history.back();else $('reader').close();};
$('reader').addEventListener('cancel',event=>{event.preventDefault();$('reader-close').click();});
function render(){
 const search=$('search').value.trim().toLowerCase(),topic=$('topic').value,cutoff=Date.now()-Number($('period').value)*86400000;
 const excluded=state.excluded.split(/[,、\n]/).map(x=>x.trim().toLowerCase()).filter(Boolean);
 const view=$('view').value,liked=new Set(state.likes.map(l=>l.u));
 // ハート一覧は一覧から消えた古い記事も含め、ハートを付けた新しい順に出す（期間・除外設定は適用しない）。
 const current=new Map(data.articles.map(a=>[a.url,a]));
 const pool=view==='liked'?[...state.likes].sort((x,y)=>y.t-x.t).map(l=>current.get(l.u)||{url:l.u,title:l.title,source:l.source,published:l.published}):data.articles;
 const eligible=pool.filter(a=>view==='liked'||!state.paid.includes(a.url)&&!state.blocked.includes(a.source)&&Date.parse(a.published)>=cutoff).filter(a=>(!$('unread').checked||!state.read.includes(a.url))&&(view!=='saved'||state.saved.includes(a.url))&&(!topic||patterns[topic].test(a.title))&&!excluded.some(w=>a.title.toLowerCase().includes(w)));
 const recommended=$('sort').value==='recommended'&&view!=='liked',model=recommended&&buildModel(data.articles,state.clicks,Date.now(),state.likes,state.seen);
 const trackSeen=recommended&&view==='all'&&!search;
 seenObserver.disconnect();
 const {primary,body}=splitMatches(recommended?rankArticles(eligible,model,new Set([...state.read,...liked])):eligible,search),bodyUrls=new Set(body.map(a=>a.url)),items=[...primary,...body];
 $('articles').replaceChildren();$('count').textContent=search?`タイトル・配信元 ${primary.length}件 / 本文・概要 ${body.length}件`:`${items.length.toLocaleString()}件`;
 let bodyHeadingShown=false;
 for(const a of items.slice(0,limit)){
  let url;try{url=new URL(a.url);if(!['http:','https:'].includes(url.protocol))continue;}catch{continue;}
  if(bodyUrls.has(a.url)&&!bodyHeadingShown){
   const heading=document.createElement('h2');heading.className='body-heading';heading.textContent='本文・概要にキーワードを含む記事';
   const note=document.createElement('p');note.className='search-note';note.textContent='配信元のRSSで取得できた本文・概要から検索しています。全文を検索できるとは限りません。';
   $('articles').append(heading,note);bodyHeadingShown=true;
  }
  const article=document.createElement('article');article.className='article';article.classList.toggle('read',state.read.includes(a.url));
  const meta=document.createElement('div');meta.className='meta';const source=document.createElement('span');source.className='source';source.textContent=a.source;const time=document.createElement('time');time.dateTime=a.published;time.textContent=new Date(a.published).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});meta.append(source,time);
  const link=document.createElement('a');link.className='title';link.textContent=a.title;link.href=url.href;link.rel='noopener noreferrer';
  const markRead=()=>{
   if(!state.read.includes(a.url))state.read.push(a.url);
   state.clicks=recordClick(state.clicks,a);persist();
   article.classList.add('read');
  };
  link.addEventListener('click',event=>{
   markRead();
   // 本文を先読み済みなら、通信せずにアプリ内で広告なしの本文を開く。
   if(reader.has(a.url)&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){event.preventDefault();openReader(a);}
  });
  link.addEventListener('auxclick',event=>{if(event.button===1)markRead();});
  // Mark before the browser switches to the article's new tab.
  link.addEventListener('pointerup',event=>{if(event.button===0)markRead();});
  const actions=document.createElement('div');actions.className='actions';
  // 押しても並び替えずにハートの表示だけ変える。おすすめ順には次に一覧を表示したときに反映される。
  const heart=button('',()=>{state.likes=toggleLike(state.likes,a);persist();showHeart(state.likes.some(l=>l.u===a.url));});heart.classList.add('heart');heart.setAttribute('aria-label','ハート');heart.title='ハート';
  const showHeart=on=>{heart.textContent=on?'♥':'♡';heart.classList.toggle('active',on);heart.setAttribute('aria-pressed',on);};showHeart(liked.has(a.url));
  actions.append(button(state.saved.includes(a.url)?'✓ 保存済み':'＋ あとで読む',()=>{state.saved=state.saved.includes(a.url)?state.saved.filter(x=>x!==a.url):[...state.saved,a.url];persist();render();},state.saved.includes(a.url)),button('有料だった',()=>{state.paid.push(a.url);persist();render();toast('記事を非表示にしました');if(confirm(`「${a.source}」の記事をすべて除外しますか？\nキャンセルすると、この記事だけを非表示にします。`)){state.blocked.push(a.source);persist();render();}}));
  article.append(heart,meta,link);
  if(bodyUrls.has(a.url)){
   const snippet=document.createElement('p');snippet.className='match-snippet';const text=a.body||'',index=text.toLowerCase().indexOf(search),start=Math.max(0,index-35);
   const end=Math.min(text.length,index+search.length+65);
   snippet.append(document.createTextNode((start?'…':'')+text.slice(start,index)));
   const mark=document.createElement('mark');mark.textContent=text.slice(index,index+search.length);snippet.append(mark,document.createTextNode(text.slice(index+search.length,end)+(end<text.length?'…':'')));article.append(snippet);
  }
  article.append(actions);$('articles').append(article);
  if(trackSeen){article.article=a;seenObserver.observe(article);}
 }
 if(!items.length){const p=document.createElement('p');p.className='empty';p.textContent=view==='liked'&&!state.likes.length?'まだハートを付けた記事はありません。気に入った記事の「♡」を押すと、ここに集まり、おすすめ順にも反映されます。':'該当する記事がありません。検索条件や配信元の除外設定を変更してください。';$('articles').append(p);}
 $('more').hidden=items.length<=limit;
 schedulePrefetch(items.slice(0,limit));
}
$('sort').value=state.sort;$('sort').addEventListener('change',()=>{state.sort=$('sort').value;persist();});
for(const id of ['search','topic','period','view','unread','sort'])$(id).addEventListener(id==='search'?'input':'change',()=>{limit=40;if(data)render();});
$('more').onclick=()=>{limit+=40;render();};
$('settings').onclick=()=>{
 const sources=new Map((data?.sources||[]).map(s=>[s.name,{...s}]));
 for(const a of data?.articles||[]){if(!sources.has(a.source))sources.set(a.source,{name:a.source,ok:true,count:0});}
 for(const name of state.blocked){if(!sources.has(name))sources.set(name,{name,ok:true,count:0});}
 for(const s of sources.values())s.count=(data?.articles||[]).filter(a=>a.source===s.name).length;
 $('sources').replaceChildren();for(const s of sources.values()){const label=document.createElement('label'),check=document.createElement('input'),name=document.createElement('span'),status=document.createElement('small');check.type='checkbox';check.checked=!state.blocked.includes(s.name);check.onchange=()=>{state.blocked=state.blocked.filter(x=>x!==s.name);if(!check.checked)state.blocked.push(s.name);persist();render();};name.textContent=s.name;status.textContent=s.ok?`${s.count}件掲載`:'取得失敗';label.append(check,name,status);$('sources').append(label);}
 const model=buildModel(data?.articles||[],state.clicks,Date.now(),state.likes,state.seen),tops=topInterests(model),skips=topSkips(model);
 $('interests').textContent=(tops.length?`よく開く傾向：${tops.map(([f])=>featureLabel(f)).join('、')}`:'記事を開いたりハートを付けたりすると、好みの配信元・分野・キーワードを学習して「おすすめ順」に反映します。')+(skips.length?`\nあまり開かない傾向：${skips.map(([f])=>featureLabel(f)).join('、')}`:'');
 displayControls($('display'));
 $('excluded').value=state.excluded;$('storage').textContent=storageOK?'設定はこのブラウザに保存されます。':'ブラウザへの保存が利用できません。';$('dialog').showModal();
};
$('close').onclick=()=>$('dialog').close();$('excluded').oninput=()=>{state.excluded=$('excluded').value;persist();if(data)render();};
$('reset').onclick=()=>{if(confirm('既読・閲覧履歴・表示の記録・ハート・保存・有料報告・除外設定をすべてリセットしますか？')){state={read:[],saved:[],paid:[],blocked:[],excluded:'',clicks:[],likes:[],seen:[],sort:state.sort,readerStyle:state.readerStyle,theme:state.theme};persist();$('dialog').close();if(data)render();}};
async function load(){
 try{const res=await fetch('./articles.json',{cache:'no-cache'});if(!res.ok)throw new Error();data=await res.json();
 // 閲覧履歴の記録前に既読にした記事は、公開日時に開いたものとして履歴に取り込む。
 if(!state.clicks.length&&state.read.length){const read=new Set(state.read);for(const a of data.articles)if(read.has(a.url))state.clicks=recordClick(state.clicks,a,Math.min(Date.now(),Date.parse(a.published)));if(state.clicks.length){state.clicks.sort((x,y)=>x.t-y.t);persist();}}$('status').textContent=`${data.sources.filter(x=>x.ok).length}配信元から収集 · 最終更新 ${new Date(data.updatedAt).toLocaleString('ja-JP')}`;limit=40;render();return true;}
 catch{if(data)toast('記事を更新できませんでした。時間をおいてもう一度お試しください。');else $('status').textContent='記事を取得できませんでした。時間をおいて再読み込みしてください。';return false;}
}
// 画面の一番上で下に引っ張って離すと、記事を取り直して並べ直す（ホーム画面のアプリ表示ではブラウザ標準の更新が使えないため）。
const pull={start:null,distance:0,busy:false},threshold=70;
function showPull(text,distance){$('pull').textContent=text;$('pull').style.transform=`translate(-50%,${Math.min(distance,threshold+30)-50}px)`;$('pull').classList.toggle('visible',distance>0);}
addEventListener('touchstart',event=>{pull.start=!pull.busy&&scrollY<=0&&event.touches.length===1&&!$('dialog').open&&!$('reader').open?event.touches[0].clientY:null;pull.distance=0;},{passive:true});
addEventListener('touchmove',event=>{if(pull.start===null)return;pull.distance=Math.max(0,(event.touches[0].clientY-pull.start)*0.5);if(scrollY>0)pull.distance=0;showPull(pull.distance>=threshold?'↻ 離すと更新':'↓ 引っ張って更新',pull.distance);},{passive:true});
addEventListener('touchend',async()=>{
 if(pull.start===null)return;pull.start=null;
 if(pull.distance<threshold){showPull('',0);return;}
 pull.busy=true;showPull('更新中…',threshold);
 if(await checkUpdate())return;
 const ok=await load();
 showPull(ok?'更新しました':'更新できませんでした',threshold);setTimeout(()=>{showPull('',0);pull.busy=false;},700);
});
// 新しい版が公開されていたら読み込み直す。ホーム画面のアプリは開きっぱなしになり、古い画面のまま使い続けてしまうことがあるため。
// 同じ版のために読み込み直すのは1回だけにして、通信が遅く古い保存分が返ってきたときに繰り返さないようにする。
const appVersion=new URL(import.meta.url).searchParams.get('v');
async function checkUpdate(){
 try{
  const latest=(await (await fetch('./',{cache:'no-store'})).text()).match(/app\.js\?v=(\d+)/)?.[1];
  if(!latest||!appVersion||latest===appVersion||sessionStorage.getItem('tech-feed-reloaded')===latest)return false;
  sessionStorage.setItem('tech-feed-reloaded',latest);location.reload();return true;
 }catch{return false;}
}
let hiddenAt=0;
document.addEventListener('visibilitychange',()=>{if(document.hidden)hiddenAt=Date.now();else if(Date.now()-hiddenAt>5*60000)checkUpdate();});
await load();
checkUpdate();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
