'use strict';
// KomeMaku built-in options page. No external site, no external UI dependencies.
const DEFAULTS=Object.freeze({
 enabled:true,fontSize:24,opacity:0.92,speed:1,density:5,selectionOrder:'popular',
 color:'#ffffff',colorMode:'single',speedMode:'fixed',language:'auto',
 hideReplies:false,preserveLineBreaks:false,hideFromLines:0,featuredPercent:0,featuredScrollFromLines:0,
 translateComments:false,translateLanguage:'ja',autoShrink:true,halfLineOverlap:true,hideTimestamps:false,
 rendererMode:'auto',fpsLimit:0
});
const values={...DEFAULTS};
const I18N=globalThis.YDLI18N;
const pageLabels={
 ja:{brand:'設定センター',nav:'設定カテゴリ',breadcrumb:'設定 / すべての項目',eyebrow:'KOMEMAKU CONTROL CENTER',title:'弾幕を、自分好みに。',description:'表示頻度、優先順位、人気コメント、翻訳、描画性能まで、すべてここから変更できます。変更内容は自動保存され、YouTubeにも反映されます。',search:'設定を検索（例：コメント、FPS、翻訳）',saved:'保存しました',error:'保存に失敗しました',reset:'初期設定に戻す',resetTitle:'設定を初期状態に戻す',resetHint:'KomeMakuの設定値のみ初期化します。コメントの取得データには影響しません。',confirm:'本当に設定をすべて初期状態に戻しますか？',resetDone:'設定を初期化しました',none:'一致する設定が見つかりません',footer:'このページはKomeMaku拡張機能に内蔵されています。外部サイトへの登録は不要です。'},
 en:{brand:'Settings center',nav:'Settings categories',breadcrumb:'Settings / All options',eyebrow:'KOMEMAKU CONTROL CENTER',title:'Make danmaku yours.',description:'Control frequency, priorities, featured comments, translation and rendering performance. Changes are saved automatically and applied to YouTube.',search:'Search settings (e.g., FPS, comments, translation)',saved:'Saved',error:'Could not save settings',reset:'Reset to defaults',resetTitle:'Reset settings',resetHint:'Only KomeMaku preferences will reset. Comment data is not affected.',confirm:'Reset every preference to its default?',resetDone:'Settings reset',none:'No matching settings',footer:'This settings page is built into KomeMaku. No external website or account is needed.'},
 'zh-CN':{brand:'设置中心',nav:'设置分类',breadcrumb:'设置 / 所有选项',eyebrow:'KOMEMAKU CONTROL CENTER',title:'自定义你的弹幕。',description:'在这里调整频率、筛选顺序、热门弹幕、翻译和渲染性能。更改会自动保存并应用到 YouTube。',search:'搜索设置（例如：FPS、评论、翻译）',saved:'已保存',error:'无法保存设置',reset:'恢复默认',resetTitle:'恢复初始设置',resetHint:'仅重置 KomeMaku 设置，不影响评论数据。',confirm:'确定将所有设置恢复为默认值吗？',resetDone:'已恢复默认',none:'未找到匹配设置',footer:'此页面内置于 KomeMaku 扩展程序，无需外部网站或账户。'},
 'zh-TW':{brand:'設定中心',nav:'設定分類',breadcrumb:'設定 / 所有選項',eyebrow:'KOMEMAKU CONTROL CENTER',title:'打造你的彈幕。',description:'在此調整顯示頻率、優先順序、熱門留言、翻譯及繪製效能。變更會自動儲存並套用到 YouTube。',search:'搜尋設定（例如：FPS、留言、翻譯）',saved:'已儲存',error:'無法儲存設定',reset:'恢復預設值',resetTitle:'恢復預設設定',resetHint:'僅重設 KomeMaku 設定，不影響留言資料。',confirm:'確定要將全部設定恢復為預設值嗎？',resetDone:'設定已重設',none:'沒有符合的設定',footer:'此頁面內建於 KomeMaku 擴充功能，不需外部網站或帳號。'}
};
const groups=[
 {id:'general',icon:'⚙',title:['基本設定','General','基本设置','基本設定'],subtitle:['弾幕の有効化と言語','Turn on danmaku and choose language','弹幕开关与界面语言','彈幕開關與介面語言'],keys:['enabled','language']},
 {id:'selection',icon:'▤',title:['表示・優先順位','Selection','显示与优先级','顯示與優先順序'],subtitle:['大量コメントをどれから表示するか','Choose which comments win when space runs out','决定优先显示哪些评论','決定優先顯示哪些留言'],keys:['selectionOrder','density','hideReplies','hideFromLines','preserveLineBreaks','hideTimestamps']},
 {id:'featured',icon:'★',title:['人気コメント','Featured comments','热门评论','熱門留言'],subtitle:['画面下端に拡大表示するコメント','Control highlighted comments at bottom','底部高赞弹幕','底部熱門留言'],keys:['featuredPercent','featuredScrollFromLines']},
 {id:'appearance',icon:'◉',title:['見た目・動き','Appearance','外观与动画','外觀與動態'],subtitle:['文字、流れる速度、表示の重なり','Text, colors, movement and spacing','文字、颜色、速度与重叠','文字、色彩、速度與重疊'],keys:['fontSize','speed','opacity','colorMode','color','speedMode','autoShrink','halfLineOverlap']},
 {id:'performance',icon:'⚡',title:['パフォーマンス','Performance','性能','效能'],subtitle:['描画エンジンとFPSの設定','Renderer and FPS settings','渲染引擎与帧率','繪製引擎與FPS'],keys:['rendererMode','fpsLimit']},
 {id:'translation',icon:'文',title:['翻訳','Translation','翻译','翻譯'],subtitle:['コメントの翻訳を有効化','Translate comments only when enabled','开启后翻译评论','啟用時翻譯留言'],keys:['translateComments','translateLanguage']}
];
const choices={
 language:[['auto','auto'],['ja','日本語'],['en','English'],['zh-CN','简体中文'],['zh-TW','繁體中文']],
 selectionOrder:[['popular','selectionPopular'],['newest','selectionNewest']],
 rendererMode:[['auto','rendererAuto'],['webgl2','WebGL2'],['canvas','Canvas 2D']],
 fpsLimit:[[0,'fpsAuto'],[15,'15 FPS'],[24,'24 FPS'],[30,'30 FPS'],[45,'45 FPS'],[60,'60 FPS'],[120,'120 FPS']],
 colorMode:[['single','colorSingle'],['random','colorRandom']],
 speedMode:[['fixed','speedFixed'],['random','speedRandom']],
 translateLanguage:[['ja','日本語'],['en','English'],['zh-CN','简体中文'],['zh-TW','繁體中文'],['ko','한국어'],['es','Español'],['fr','Français'],['de','Deutsch']]
};
const ranges={fontSize:[14,38,1],speed:[.5,2,.1],density:[1,11,1],opacity:[.2,1,.05],hideFromLines:[0,10,1],featuredPercent:[0,30,1],featuredScrollFromLines:[0,10,1]};
const descriptions={
 selectionOrder:['人気順か投稿日時の新しい順で表示対象を選びます。投稿日時が不明なものは「新しい順」では後回しになります。','Keep most liked or most recently published comments. Unknown dates rank last in Newest mode.','按点赞数或发布时间选择；未知日期排在最新模式末尾。','依按讚數或發佈時間選擇；未知日期排在最新模式末尾。'],
 density:['無制限は事前の件数制限のみ解除します。画面の空き不足では一部を除外します。','Unlimited removes the count cap, not physical screen limits.','无限制仅移除数量上限，屏幕仍有容量限制。','無限制只移除數量上限，畫面仍有容量限制。'],
 featuredPercent:['表示対象のうち、いいね数の多いコメントを画面下端に約1.5倍で表示します。','Enlarge top-liked comments at bottom to 1.5×.','将高赞评论放大1.5倍显示在底部。','在底部以1.5倍顯示熱門留言。'],
 featuredScrollFromLines:['指定行数以上の人気コメントは、通常の右から左への弾幕として流します（0で無効）。','Featured comments with at least this many source lines scroll normally (0=off).','达到此行数的热门评论正常滚动（0为关闭）。','達此行數的熱門留言改為正常捲動（0為關閉）。'],
 hideFromLines:['元の改行数で判定します。0なら非表示制限なし。','Uses original line count. 0 disables the filter.','按原始行数判断，0表示关闭。','依原始行數判斷，0表示關閉。'],
 halfLineOverlap:['通常は重ねず、レーンが埋まったときだけ半行ずらします。','Only stagger half a row when all normal rows are crowded.','仅在普通行已满时错开半行。','僅在一般行已滿時錯開半行。'],
 translateComments:['オンにしたときだけ、必要なコメント本文を外部翻訳サービスへ送信します。','Only enabled comments are sent to an external translation service.','开启时将必要的评论发送至外部翻译服务。','開啟時會將必要的留言傳送到外部翻譯服務。'],
 rendererMode:['自動設定ではWebGL2を優先し、使えなければCanvas 2Dへ切り替えます。','Auto prefers WebGL2, with Canvas 2D fallback.','自动优先WebGL2，不可用时回退Canvas 2D。','自動優先WebGL2，無法使用時回退Canvas 2D。'],
 fpsLimit:['自動では描画負荷に応じてFPSを調整します。','Auto adapts FPS to rendering cost.','自动根据渲染负载调整帧率。','自動根據繪製負載調整FPS。']
};
let activeGroup=groups[0].id,searchValue='',statusTimer;
const locale=()=>I18N.detect(values.language);
const localeIndex=()=>({ja:0,en:1,'zh-CN':2,'zh-TW':3})[locale()]??0;
const translate=key=>I18N.translate(locale(),key);
const L=key=>pageLabels[locale()][key];
const $=id=>document.getElementById(id);
function displayValue(key,value){
 if(key==='fontSize')return value+' px';
 if(key==='speed')return Number(value).toFixed(1)+' ×';
 if(key==='opacity'||key==='featuredPercent')return Math.round(value*(key==='opacity'?100:1))+'%';
 if(key==='density')return Number(value)===11?translate('unlimited'):value+'/10';
 if(key==='hideFromLines'||key==='featuredScrollFromLines')return value===0?translate('unlimited'):value+' '+translate('linesOrMore');
 return String(value);
}
function describe(key){return (descriptions[key]||[])[localeIndex()]||'';}
function notify(message,error=false){const e=$('saveStatus');e.textContent=message;e.style.color=error?'#ff9aaf':'#77dcb5';clearTimeout(statusTimer);statusTimer=setTimeout(()=>e.textContent='',2600);}
function makeControl(key){
 const holder=document.createElement('div');holder.className='setting-control';
 let input;
 if(typeof DEFAULTS[key]==='boolean'){
   const wrap=document.createElement('label');wrap.className='switch';
   input=document.createElement('input');input.type='checkbox';input.setAttribute('aria-label',translate(key));
   const track=document.createElement('span');track.className='track';wrap.append(input,track);holder.append(wrap);
 }else if(ranges[key]){
   input=document.createElement('input');input.type='range';
   [input.min,input.max,input.step]=ranges[key].map(String);
   const output=document.createElement('output');output.id=key+'Out';holder.append(input,output);
 }else if(key==='color'){
   input=document.createElement('input');input.type='color';holder.append(input);
 }else{
   input=document.createElement('select');
   for(const [value,title] of choices[key]){const option=document.createElement('option');option.value=String(value);
     option.textContent=I18N.translate(locale(),title)||title;input.append(option);}
   holder.append(input);
 }
 input.id=key;input.dataset.setting=key;input.setAttribute('aria-label',translate(key));
 syncInput(input,key);
 const event=input.type==='range'||input.type==='color'?'input':'change';
 input.addEventListener(event,async()=>{
   const value=typeof DEFAULTS[key]==='boolean'?input.checked
     :typeof DEFAULTS[key]==='number'?Number(input.value):input.value;
   values[key]=value;syncInput(input,key);
   if(key==='language')render();
   if(key==='colorMode'&&$('color'))$('color').disabled=value==='random';
   try{await chrome.storage.local.set({[key]:value});notify(L('saved'));}
   catch{notify(L('error'),true);}
 });
 return holder;
}
function syncInput(input,key){
 if(input.type==='checkbox')input.checked=!!values[key];else input.value=String(values[key]);
 const out=input.parentElement?.querySelector('output')||$(key+'Out');if(out)out.textContent=displayValue(key,values[key]);
 if(key==='color')input.disabled=values.colorMode==='random';
}
function buildItem(key){
 const row=document.createElement('div');row.className='setting-item';row.dataset.label=translate(key).toLocaleLowerCase()+' '+describe(key).toLocaleLowerCase();
 const info=document.createElement('div');
 const label=document.createElement('label');label.className='setting-label';label.htmlFor=key;label.textContent=translate(key);info.append(label);
 const description=describe(key);if(description){const p=document.createElement('p');p.className='setting-description';p.textContent=description;info.append(p);}
 row.append(info,makeControl(key));return row;
}
function render(){
 const idx=localeIndex();document.documentElement.lang=locale();document.title='KomeMaku — '+L('brand');
 for(const [id,k] of [['brandSubtitle','brand'],['navLabel','nav'],['breadcrumb','breadcrumb'],['heroEyebrow','eyebrow'],['heroTitle','title'],['heroDescription','description'],['resetTitle','resetTitle'],['resetHint','resetHint'],['resetDefaults','reset'],['pageFooter','footer']])$(id).textContent=L(k);
 $('settingsSearch').placeholder=L('search');$('versionText').textContent='KomeMaku v'+chrome.runtime.getManifest().version;
 const nav=$('sectionNav'),container=$('settingsContainer');nav.replaceChildren();container.replaceChildren();
 let visibleCount=0;
 for(const group of groups){
   const items=group.keys.filter(key=>!searchValue||[translate(key),describe(key),key,group.title[idx]].join(' ').toLocaleLowerCase().includes(searchValue));
   if(!items.length)continue;
   visibleCount+=items.length;
   const button=document.createElement('button');button.type='button';button.className='nav-item'+(activeGroup===group.id?' active':'');button.dataset.group=group.id;
   const icon=document.createElement('span');icon.className='nav-icon';icon.textContent=group.icon;
   button.append(icon,document.createTextNode(group.title[idx]));button.addEventListener('click',()=>{activeGroup=group.id;renderNavActive();document.getElementById(group.id)?.scrollIntoView({behavior:'smooth'});});nav.append(button);
   const section=document.createElement('section');section.id=group.id;section.className='category-section';
   const head=document.createElement('div');head.className='category-heading';
   const symbol=document.createElement('div');symbol.className='category-symbol';symbol.textContent=group.icon;
   const labels=document.createElement('div');const h2=document.createElement('h2');h2.textContent=group.title[idx];const p=document.createElement('p');p.textContent=group.subtitle[idx];labels.append(h2,p);head.append(symbol,labels);
   const card=document.createElement('div');card.className='settings-card';for(const key of items)card.append(buildItem(key));
   section.append(head,card);container.append(section);
 }
 if(!visibleCount){const empty=document.createElement('p');empty.className='no-results';empty.textContent=L('none');container.append(empty);}
 const color=$('color');if(color)color.disabled=values.colorMode==='random';
}
function renderNavActive(){for(const item of document.querySelectorAll('.nav-item'))item.classList.toggle('active',item.dataset.group===activeGroup);}
$('settingsSearch').addEventListener('input',e=>{searchValue=e.target.value.trim().toLocaleLowerCase();render();});
$('resetDefaults').addEventListener('click',async()=>{
 if(!confirm(L('confirm')))return;
 Object.assign(values,DEFAULTS);
 try{await chrome.storage.local.set({...DEFAULTS});searchValue='';$('settingsSearch').value='';render();notify(L('resetDone'));}
 catch{notify(L('error'),true);}
});
document.addEventListener('keydown',event=>{
 if(event.key==='/'&&!(event.target instanceof HTMLInputElement)&&!(event.target instanceof HTMLTextAreaElement)){event.preventDefault();$('settingsSearch').focus();}
});
chrome.storage.onChanged.addListener((changes,area)=>{
 if(area!=='local')return;
 let refresh=false;
 for(const [key,{newValue}] of Object.entries(changes)){
   if(!(key in DEFAULTS)||typeof newValue!==typeof DEFAULTS[key])continue;
   if(values[key]!==newValue){values[key]=newValue;refresh=true;}
 }
 if(refresh)render();
});
chrome.storage.local.get(DEFAULTS).then(stored=>{
 for(const [key,initial] of Object.entries(DEFAULTS))if(typeof stored[key]===typeof initial)values[key]=stored[key];
 render();
}).catch(()=>{render();notify(L('error'),true);});
