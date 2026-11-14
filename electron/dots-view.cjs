const {createHash}=require('node:crypto');
const HOME='https://chatgpt.com/dots';
const INTERNAL=new Set(['chatgpt.com','www.chatgpt.com','auth.chatgpt.com','auth.openai.com','auth0.openai.com','accounts.openai.com']);
function safeURL(value){
 if(typeof value!=='string'||value.length>16000)return null;
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port?url:null}catch{return null}
}
function internalURL(value){const url=safeURL(value);return !!url&&INTERNAL.has(url.hostname.toLowerCase());}
function checkedBounds(value,window){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4||Object.keys(value).some(k=>!['x','y','width','height'].includes(k))||
  Object.values(value).some(v=>typeof v!=='number'||!Number.isFinite(v)))throw Error('Dots 화면 위치를 확인해 주세요.');
 const {width,height}=window.getContentBounds();
 if(value.x<0||value.y<0||value.width<120||value.height<120||value.x+value.width>width+1||value.y+value.height>height+1||value.width>32768||value.height>32768)throw Error('Dots 화면은 앱 안의 표시 영역에만 열 수 있습니다.');
 const x=Math.floor(value.x),y=Math.floor(value.y);
 return {x,y,width:Math.min(Math.ceil(value.width),width-x),height:Math.min(Math.ceil(value.height),height-y)};
}
class DotsView {
 constructor(options){
  this.options=options;this.electron=options.electron||require('electron');this.view=null;this.host=null;this.attached=false;this.visible=false;this.loading=false;this.error='';this.external=null;this.owner='';this.closed=false;this.sessions=new Map();this.listeners=[];
  this.watchdog=setInterval(()=>{try{if(this.view&&this.owner!==this.identity())this.destroy();else if(this.visible&&!this.allowed())this.hide();}catch{this.hide();}},150);this.watchdog.unref?.();
 }
 identity(){const revision=this.options.accountRevision?.()??0,owner=this.options.ownerHash?.()||'signed-out';
  if(!Number.isSafeInteger(revision)||revision<0||typeof owner!=='string'||owner.length>200)throw Error('Dots 계정 구분을 확인해 주세요.');
  return createHash('sha256').update('flowrium-dots-v1:'+owner+'\0'+revision).digest('hex');
 }
 allowed(){const win=this.options.getWindow();return !this.closed&&this.options.canShow?.()!==false&&win&&!win.isDestroyed()&&win.isVisible()&&(!win.isFocused||win.isFocused());}
 state(){return {available:!this.closed,visible:this.visible&&!!this.allowed(),loading:this.loading,error:this.error||undefined,externalHost:this.external?safeURL(this.external.url)?.hostname:undefined};}
 guard(){if(!this.allowed())throw Error('잠금과 열린 창을 확인한 뒤 Dots 탭을 다시 열어 주세요.');}
 listen(target,event,callback){target.on(event,callback);this.listeners.push(()=>target.removeListener(event,callback));}
 destroy(){
  const view=this.view;this.hide();this.view=null;this.host=null;this.owner='';this.loading=false;this.external=null;this.error='';for(const remove of this.listeners.splice(0))remove();
  if(view&&!view.webContents.isDestroyed())view.webContents.close({waitForBeforeUnload:false});
 }
 invalidate(){this.destroy();}
 hide(){
  if(this.view){this.view.setVisible(false);if(!this.view.webContents.isDestroyed())this.view.webContents.setAudioMuted(true);if(this.attached&&this.host&&!this.host.isDestroyed())this.host.contentView.removeChildView(this.view);}
  this.attached=false;this.visible=false;return this.state();
 }
 externalRequest(value){const url=safeURL(value);if(!url)return;this.external={url:url.href,owner:this.owner};}
 ensure(){
  this.guard();const owner=this.identity(),host=this.options.getWindow();
  if(this.view&&(owner!==this.owner||host!==this.host||this.view.webContents.isDestroyed()))this.destroy();
  if(this.view)return this.view;
  const partition='persist:flowrium-dots-'+owner,session=this.electron.session.fromPartition(partition,{cache:true});this.sessions.set(partition,session);
  session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));session.setPermissionCheckHandler(()=>false);session.setDevicePermissionHandler?.(()=>false);
  const view=new this.electron.WebContentsView({webPreferences:{partition,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:false,webSecurity:true,webviewTag:false,allowRunningInsecureContent:false,backgroundThrottling:true}});
  this.view=view;this.host=host;this.owner=owner;this.loading=true;this.error='';
  view.setVisible(false);view.webContents.setAudioMuted(true);view.setBackgroundColor?.('#f5f7fa');
  const own=()=>this.view===view&&!this.closed;
  const navigate=(event,value)=>{const url=typeof value==='string'?value:value?.url;if(!internalURL(url)){event.preventDefault();if(own())this.externalRequest(url);}};
  this.listen(view.webContents,'will-navigate',navigate);this.listen(view.webContents,'will-redirect',navigate);
  view.webContents.setWindowOpenHandler(({url})=>{if(own()&&internalURL(url))view.webContents.loadURL(url).catch(()=>{});else if(own())this.externalRequest(url);return {action:'deny'};});
  this.listen(view.webContents,'did-start-loading',()=>{if(own()){this.loading=true;this.error='';}});
  this.listen(view.webContents,'did-stop-loading',()=>{if(own())this.loading=false;});
  this.listen(view.webContents,'did-fail-load',(_event,code,_description,_url,mainFrame)=>{if(own()&&code!==-3&&mainFrame!==false){this.loading=false;this.error='공식 Dots 화면을 열지 못했습니다. 다시 시도하거나 외부 브라우저에서 여세요.';}});
  this.listen(view.webContents,'render-process-gone',()=>{if(own()){this.hide();this.loading=false;this.error='Dots 화면이 종료됐습니다. 새로고침하거나 외부 브라우저에서 여세요.';}});
  this.listen(host,'blur',()=>this.hide());this.listen(host,'resize',()=>this.hide());this.listen(host,'sheet-begin',()=>this.hide());this.listen(host,'closed',()=>this.destroy());
  const download=(event,item,contents)=>{if(contents===view.webContents){event.preventDefault();if(own())this.externalRequest(item.getURL());}};
  this.listen(session,'will-download',download);
  view.webContents.loadURL(HOME).catch(()=>{if(own()){this.loading=false;this.error='공식 Dots 화면에 연결하지 못했습니다. 외부 브라우저에서 열 수 있습니다.';}});
  return view;
 }
 show(input){this.guard();const bounds=checkedBounds(input,this.options.getWindow()),view=this.ensure();this.guard();
  if(this.owner!==this.identity()){this.destroy();throw Error('계정이 바뀌었습니다. Dots를 다시 열어 주세요.');}
  view.setBounds(bounds);if(!this.attached){this.host.contentView.addChildView(view);this.attached=true;}
  view.setVisible(true);view.webContents.setAudioMuted(false);this.visible=true;return this.state();
 }
 reload(){this.guard();if(!this.view||this.owner!==this.identity())throw Error('Dots 탭을 먼저 열어 주세요.');this.error='';this.external=null;this.view.webContents.reload();return this.state();}
 async openExternal(){this.guard();const owner=this.identity(),url=this.external?.owner===owner?this.external.url:HOME;if(!safeURL(url))throw Error('외부 주소를 확인해 주세요.');await this.options.openExternal(url);if(owner!==this.identity())throw Error('계정이 바뀌었습니다.');this.external=null;return {opened:true};}
 async shutdown(){if(this.closed)return;clearInterval(this.watchdog);this.closed=true;this.destroy();await Promise.allSettled([...this.sessions.values()].map(s=>s.cookies?.flushStore?.()));this.sessions.clear();}
}
function registerDotsView(register,options){const runtime=new DotsView(options);register('readDotsState',()=>runtime.state());register('showDotsView',bounds=>runtime.show(bounds));register('hideDotsView',()=>runtime.hide());register('reloadDotsView',()=>runtime.reload());register('openDotsExternal',()=>runtime.openExternal());return runtime;}
module.exports={DotsView,registerDotsView,checkedBounds,internalURL,safeURL,HOME};
