import {splitMatches} from './search.js';
import {topicPatterns as patterns,recordClick,toggleLike,buildModel,rankArticles,topInterests,featureLabel} from './rank.js';
const $=id=>document.getElementById(id);
let state={read:[],saved:[],paid:[],blocked:[],excluded:'',clicks:[],likes:[],sort:'recommended'},data,limit=40,storageOK=true;
try{const s=JSON.parse(localStorage.getItem('tech-feed-v1'));if(s){for(const k of ['read','saved','paid','blocked'])if(Array.isArray(s[k]))state[k]=s[k].filter(x=>typeof x==='string');if(typeof s.excluded==='string')state.excluded=s.excluded;if(Array.isArray(s.clicks))state.clicks=s.clicks.filter(c=>c&&typeof c.u==='string'&&Number.isFinite(c.t)&&Array.isArray(c.f));if(Array.isArray(s.likes))state.likes=s.likes.filter(l=>l&&typeof l.u==='string'&&typeof l.title==='string'&&typeof l.source==='string'&&Number.isFinite(l.t)&&Array.isArray(l.f));if(['recommended','newest'].includes(s.sort))state.sort=s.sort;}}catch{storageOK=false;}
function toast(message){$('toast').textContent=message;$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',3500);}
function persist(){try{localStorage.setItem('tech-feed-v1',JSON.stringify(state));}catch{storageOK=false;toast('保存できません。設定はこのページを開いている間だけ有効です。');}}
function button(label,fn,active=false){const b=document.createElement('button');b.textContent=label;b.classList.toggle('active',active);b.addEventListener('click',fn);return b;}
function render(){
 const search=$('search').value.trim().toLowerCase(),topic=$('topic').value,cutoff=Date.now()-Number($('period').value)*86400000;
 const excluded=state.excluded.split(/[,、\n]/).map(x=>x.trim().toLowerCase()).filter(Boolean);
 const view=$('view').value,liked=new Set(state.likes.map(l=>l.u));
 // ハート一覧は一覧から消えた古い記事も含め、ハートを付けた新しい順に出す（期間・除外設定は適用しない）。
 const current=new Map(data.articles.map(a=>[a.url,a]));
 const pool=view==='liked'?[...state.likes].sort((x,y)=>y.t-x.t).map(l=>current.get(l.u)||{url:l.u,title:l.title,source:l.source,published:l.published}):data.articles;
 const eligible=pool.filter(a=>view==='liked'||!state.paid.includes(a.url)&&!state.blocked.includes(a.source)&&Date.parse(a.published)>=cutoff).filter(a=>(!$('unread').checked||!state.read.includes(a.url))&&(view!=='saved'||state.saved.includes(a.url))&&(!topic||patterns[topic].test(a.title))&&!excluded.some(w=>a.title.toLowerCase().includes(w)));
 const recommended=$('sort').value==='recommended'&&view!=='liked',model=recommended&&buildModel(data.articles,state.clicks,Date.now(),state.likes);
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
  link.addEventListener('click',markRead);
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
 }
 if(!items.length){const p=document.createElement('p');p.className='empty';p.textContent=view==='liked'&&!state.likes.length?'まだハートを付けた記事はありません。気に入った記事の「♡」を押すと、ここに集まり、おすすめ順にも反映されます。':'該当する記事がありません。検索条件や配信元の除外設定を変更してください。';$('articles').append(p);}
 $('more').hidden=items.length<=limit;
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
 const tops=topInterests(buildModel(data?.articles||[],state.clicks,Date.now(),state.likes));$('interests').textContent=tops.length?`よく開く傾向：${tops.map(([f])=>featureLabel(f)).join('、')}`:'記事を開いたりハートを付けたりすると、好みの配信元・分野・キーワードを学習して「おすすめ順」に反映します。';
 $('excluded').value=state.excluded;$('storage').textContent=storageOK?'設定はこのブラウザに保存されます。':'ブラウザへの保存が利用できません。';$('dialog').showModal();
};
$('close').onclick=()=>$('dialog').close();$('excluded').oninput=()=>{state.excluded=$('excluded').value;persist();if(data)render();};
$('reset').onclick=()=>{if(confirm('既読・閲覧履歴・ハート・保存・有料報告・除外設定をすべてリセットしますか？')){state={read:[],saved:[],paid:[],blocked:[],excluded:'',clicks:[],likes:[],sort:state.sort};persist();$('dialog').close();if(data)render();}};
try{const res=await fetch('./articles.json',{cache:'no-cache'});if(!res.ok)throw new Error();data=await res.json();
 // 閲覧履歴の記録前に既読にした記事は、公開日時に開いたものとして履歴に取り込む。
 if(!state.clicks.length&&state.read.length){const read=new Set(state.read);for(const a of data.articles)if(read.has(a.url))state.clicks=recordClick(state.clicks,a,Math.min(Date.now(),Date.parse(a.published)));if(state.clicks.length){state.clicks.sort((x,y)=>x.t-y.t);persist();}}$('status').textContent=`${data.sources.filter(x=>x.ok).length}配信元から収集 · 最終更新 ${new Date(data.updatedAt).toLocaleString('ja-JP')}`;render();}catch{$('status').textContent='記事を取得できませんでした。時間をおいて再読み込みしてください。';}
