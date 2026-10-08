const $=id=>document.getElementById(id);
let state={read:[],saved:[],paid:[],blocked:[],excluded:''},data,limit=40,storageOK=true;
try{const s=JSON.parse(localStorage.getItem('tech-feed-v1'));if(s){for(const k of ['read','saved','paid','blocked'])if(Array.isArray(s[k]))state[k]=s[k].filter(x=>typeof x==='string');if(typeof s.excluded==='string')state.excluded=s.excluded;}}catch{storageOK=false;}
const patterns={'AI・生成AI':/AI|生成|機械学習|LLM|GPT|Claude|Gemini/i,'Web・開発':/開発|実装|JavaScript|TypeScript|React|Python|プログラ|CSS|HTML|コード|エンジニア/i,'セキュリティ':/セキュリティ|脆弱|攻撃|漏洩|認証|マルウェア/i,'クラウド・インフラ':/クラウド|AWS|Azure|サーバ|Docker|Kubernetes|インフラ|データベース|SRE/i,'ガジェット':/スマホ|iPhone|Android|PC|パソコン|デバイス|イヤホン|ガジェット|ディスプレイ/i};
function toast(message){$('toast').textContent=message;$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',3500);}
function persist(){try{localStorage.setItem('tech-feed-v1',JSON.stringify(state));}catch{storageOK=false;toast('保存できません。設定はこのページを開いている間だけ有効です。');}}
function button(label,fn,active=false){const b=document.createElement('button');b.textContent=label;b.classList.toggle('active',active);b.addEventListener('click',fn);return b;}
function render(){
 const search=$('search').value.toLowerCase(),topic=$('topic').value,cutoff=Date.now()-Number($('period').value)*86400000;
 const excluded=state.excluded.split(/[,、\n]/).map(x=>x.trim().toLowerCase()).filter(Boolean);
 const items=data.articles.filter(a=>!state.paid.includes(a.url)&&!state.blocked.includes(a.source)&&Date.parse(a.published)>=cutoff&&(!$('unread').checked||!state.read.includes(a.url))&&($('view').value!=='saved'||state.saved.includes(a.url))&&(!topic||patterns[topic].test(a.title))&&`${a.title} ${a.source}`.toLowerCase().includes(search)&&!excluded.some(w=>a.title.toLowerCase().includes(w)));
 $('articles').replaceChildren();$('count').textContent=`${items.length.toLocaleString()}件`;
 for(const a of items.slice(0,limit)){
  let url;try{url=new URL(a.url);if(!['http:','https:'].includes(url.protocol))continue;}catch{continue;}
  const article=document.createElement('article');article.className='article';article.classList.toggle('read',state.read.includes(a.url));
  const meta=document.createElement('div');meta.className='meta';const source=document.createElement('span');source.className='source';source.textContent=a.source;const time=document.createElement('time');time.dateTime=a.published;time.textContent=new Date(a.published).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});meta.append(source,time);
  const link=document.createElement('a');link.className='title';link.textContent=a.title;link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';
  const markRead=()=>{
   if(!state.read.includes(a.url)){state.read.push(a.url);persist();}
   article.classList.add('read');
  };
  link.addEventListener('click',markRead);
  link.addEventListener('auxclick',event=>{if(event.button===1)markRead();});
  // Mark before the browser switches to the article's new tab.
  link.addEventListener('pointerup',event=>{if(event.button===0)markRead();});
  const actions=document.createElement('div');actions.className='actions';
  actions.append(button(state.saved.includes(a.url)?'✓ 保存済み':'＋ あとで読む',()=>{state.saved=state.saved.includes(a.url)?state.saved.filter(x=>x!==a.url):[...state.saved,a.url];persist();render();},state.saved.includes(a.url)),button('有料だった',()=>{state.paid.push(a.url);persist();render();toast('記事を非表示にしました');if(confirm(`「${a.source}」の記事をすべて除外しますか？\nキャンセルすると、この記事だけを非表示にします。`)){state.blocked.push(a.source);persist();render();}}));
  article.append(meta,link,actions);$('articles').append(article);
 }
 if(!items.length){const p=document.createElement('p');p.className='empty';p.textContent='該当する記事がありません。検索条件や配信元の除外設定を変更してください。';$('articles').append(p);}
 $('more').hidden=items.length<=limit;
}
for(const id of ['search','topic','period','view','unread'])$(id).addEventListener(id==='search'?'input':'change',()=>{limit=40;if(data)render();});
$('more').onclick=()=>{limit+=40;render();};
$('settings').onclick=()=>{
 const sources=new Map((data?.sources||[]).map(s=>[s.name,{...s}]));
 for(const a of data?.articles||[]){if(!sources.has(a.source))sources.set(a.source,{name:a.source,ok:true,count:0});}
 for(const name of state.blocked){if(!sources.has(name))sources.set(name,{name,ok:true,count:0});}
 for(const s of sources.values())s.count=(data?.articles||[]).filter(a=>a.source===s.name).length;
 $('sources').replaceChildren();for(const s of sources.values()){const label=document.createElement('label'),check=document.createElement('input'),name=document.createElement('span'),status=document.createElement('small');check.type='checkbox';check.checked=!state.blocked.includes(s.name);check.onchange=()=>{state.blocked=state.blocked.filter(x=>x!==s.name);if(!check.checked)state.blocked.push(s.name);persist();render();};name.textContent=s.name;status.textContent=s.ok?`${s.count}件掲載`:'取得失敗';label.append(check,name,status);$('sources').append(label);}
 $('excluded').value=state.excluded;$('storage').textContent=storageOK?'設定はこのブラウザに保存されます。':'ブラウザへの保存が利用できません。';$('dialog').showModal();
};
$('close').onclick=()=>$('dialog').close();$('excluded').oninput=()=>{state.excluded=$('excluded').value;persist();if(data)render();};
$('reset').onclick=()=>{if(confirm('既読・保存・有料報告・除外設定をすべてリセットしますか？')){state={read:[],saved:[],paid:[],blocked:[],excluded:''};persist();$('dialog').close();if(data)render();}};
try{const res=await fetch('./articles.json',{cache:'no-cache'});if(!res.ok)throw new Error();data=await res.json();$('status').textContent=`${data.sources.filter(x=>x.ok).length}配信元から収集 · 最終更新 ${new Date(data.updatedAt).toLocaleString('ja-JP')}`;render();}catch{$('status').textContent='記事を取得できませんでした。時間をおいて再読み込みしてください。';}
