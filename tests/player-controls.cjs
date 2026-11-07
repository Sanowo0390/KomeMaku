const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
class El {
  constructor(tag='div'){
    this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.style={};this.dataset={};
    this.listeners={};this.attributes={};this.id='';this.className='';this.type='';this.value='';
    this.options=[];this.clientWidth=960;this.clientHeight=540;this.isConnected=false;
    const self=this;
    this.classList={contains:s=>self.className.split(/\s+/).includes(s),toggle(s,state){
      const parts=new Set(self.className.split(/\s+/).filter(Boolean));
      if(state)parts.add(s);else parts.delete(s);self.className=[...parts].join(' ');
    }};
  }
  appendChild(el){el.parentElement=this;el.isConnected=true;this.children.push(el);if(this.tagName==='SELECT')this.options.push(el);return el;}
  append(...elements){elements.forEach(e=>this.appendChild(e));}
  prepend(el){el.parentElement=this;el.isConnected=true;this.children.unshift(el);}
  remove(){this.parentElement?.children.splice(this.parentElement.children.indexOf(this),1);this.isConnected=false;this.parentElement=null;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name];}
  addEventListener(name,cb){this.listeners[name]=cb;}
  dispatch(name,event={}){this.listeners[name]?.({stopPropagation(){},target:this,...event});}
  contains(item){return this===item||this.children.some(el=>el.contains(item));}
  getContext(){return this._ctx;}
  querySelector(selector){
    if(selector==='.ytp-right-controls')return this.controls||null;
    if(selector==='.ytp-left-controls')return null;
    if(selector==='.ytp-ad-player-overlay')return null;
    return this.querySelectorAll(selector)[0]||null;
  }
  querySelectorAll(selector){
    const match=el=>selector.startsWith('[data-ydl-')
      ? el.dataset[selector.match(/^\[data-ydl-([a-z]+)="([^"]+)"\]$/)[1]==='input'?'ydlInput':
          selector.includes('output')?'ydlOutput':'ydlLabel']===selector.match(/="([^"]+)"/)[1]
      :selector[0]==='.'?el.className.split(/\s+/).includes(selector.slice(1)):false;
    const out=[];
    const walk=node=>{for(const child of node.children){if(match(child))out.push(child);walk(child);}};
    walk(this);return out;
  }
}
let onMessage=null, onChanged=null, raf=null;
const ctx={font:'',clearRect(){},save(){},restore(){},setTransform(){},strokeText(){},fillText(){},measureText:t=>({width:t.length*12})};
const stage=new El('div');stage.className='html5-video-player';stage.isConnected=true;stage.controls=new El('div');
stage.controls.className='ytp-right-controls';stage.appendChild(stage.controls);
const video=new El('video');video.paused=false;video.ended=false;video.currentTime=0;video.duration=300;
video.getBoundingClientRect=()=>({width:960});video.closest=s=>s==='.html5-video-player'?stage:null;
const docs={listeners:{},querySelector:()=>null,querySelectorAll:selector=>selector.includes('video')?[video]:[],
  createElement:tag=>{const el=new El(tag);if(tag==='canvas'){el._ctx=ctx;el.width=960;el.height=540;}return el;},
  addEventListener(name,cb){this.listeners[name]=cb;}};
const storage={enabled:true,fontSize:24,opacity:.92,speed:1,density:5,color:'#ffffff',colorMode:'single',speedMode:'fixed',language:'auto'};
const chrome={runtime:{onMessage:{addListener:fn=>onMessage=fn}}, storage:{local:{get:(defaults,cb)=>cb({...defaults,...storage}),
  set:p=>{Object.assign(storage,p);onChanged?.(Object.fromEntries(Object.entries(p).map(([key,val])=>[key,{newValue:val}])), 'local');}},
  onChanged:{addListener:fn=>onChanged=fn}}};
const handlers=new Map();
const window={devicePixelRatio:1,addEventListener:(n,fn)=>handlers.set(n,fn),dispatchEvent:e=>handlers.get(e.type)?.(e)};
const sandbox={window,document:docs,chrome,navigator:{language:'en-US'},URL,Date,Math,console,
  location:{href:'https://www.youtube.com/watch?v=abcdefghijk',pathname:'/watch'},
  ResizeObserver:class{observe(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}},
  setInterval(){},setTimeout:cb=>{cb();return 1;},clearTimeout(){},
  requestAnimationFrame:cb=>raf=cb,
  CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts?.detail;}}};
for(const f of ['logic.js','i18n.js','content.js'])vm.runInNewContext(fs.readFileSync(path.join(root,f),'utf8'),sandbox);
const button=stage.controls.children.find(x=>x.className.includes('ydl-control-button'));
assert.ok(button,'control button was inserted into YouTube controls');
assert.ok(button.title.includes('danmaku'),'English automatic UI selected');
assert.equal(button.getAttribute('aria-pressed'),'true');
const panel=stage.children.find(x=>x.className.includes('ydl-panel'));
assert.ok(panel);
assert.ok(!panel.className.includes('ydl-open'));
button.dispatch('click');
assert.ok(panel.className.includes('ydl-open'),'click opens settings');
const lang=panel.querySelector('[data-ydl-input="language"]');
assert.ok(lang);
assert.equal(lang.options.length,5);
lang.value='zh-TW';lang.dispatch('change');
assert.equal(storage.language,'zh-TW');
assert.equal(panel.querySelector('.ydl-panel-heading').textContent,'彈幕設定');
const mode=panel.querySelector('[data-ydl-input="colorMode"]');mode.value='random';mode.dispatch('change');
assert.equal(storage.colorMode,'random');
assert.equal(panel.querySelector('[data-ydl-input="color"]').disabled,true);
const speedMode=panel.querySelector('[data-ydl-input="speedMode"]');speedMode.value='random';speedMode.dispatch('change');
assert.equal(storage.speedMode,'random');
const enabled=panel.querySelector('[data-ydl-input="enabled"]');enabled.checked=false;enabled.dispatch('change');
assert.equal(button.getAttribute('aria-pressed'),'false');
panel.querySelector('.ydl-panel-close').dispatch('click');
assert.ok(!panel.className.includes('ydl-open'),'close hides settings');
console.log('PASS: player bar button opens/closes panel; 5 locale choices; live storage updates; theme/random-speed/toggle');
