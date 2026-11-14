const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const source=fs.readFileSync(path.join(__dirname,'../electron/main.cjs'),'utf8');
function fixture({diagnostics=false,reentrant=false}={}){
 const windows=[],logs=[],app=new EventEmitter();let ready=false;
 Object.assign(app,{setName(){},isPackaged:false,isReady:()=>ready,requestSingleInstanceLock:()=>true,whenReady:()=>new Promise(()=>{})});
 class Window extends EventEmitter{
  static getAllWindows(){return windows.filter(row=>!row.destroyed)}
  constructor(){super();this.destroyed=false;this.visible=true;this.minimized=false;this.focuses=0;this.webContents=Object.assign(new EventEmitter(),{session:{setPermissionRequestHandler(){},setPermissionCheckHandler(){}},setWindowOpenHandler(){}});windows.push(this);if(reentrant)app.emit('activate');}
  isDestroyed(){return this.destroyed}isMinimized(){return this.minimized}restore(){this.minimized=false}show(){this.visible=true}focus(){this.focuses++}setTitle(){}loadURL(){return Promise.resolve()}close(){this.destroyed=true;this.emit('closed')}
 }
 const modules={electron:{app,BrowserWindow:Window,ipcMain:{handle(){}}},'./store.cjs':{},'./controller.cjs':{},'./errors.cjs':{},'./version.cjs':{},'./updater.cjs':{},'./workbench.cjs':{}};
 const context=vm.createContext({require:name=>name==='node:fs'?{writeSync:(_,value)=>logs.push(value)}:Object.hasOwn(modules,name)?modules[name]:require(name),process:{env:diagnostics?{FLOWRIUM_LIFECYCLE_DIAGNOSTICS:'1'}:{},platform:'darwin'},__dirname:path.join(__dirname,'../electron')});
 vm.runInContext(source+`\nsecurity={state:()=>({hasPin:false})};drafts={beginMigration(){}};globalThis.probe={ensure:ensureWindow,complete(){launchComplete=true},quit(){quitting=true},pending:()=>windowRequestPending,current:()=>window};`,context,{filename:'main-lifecycle-fixture.cjs'});
 return{app,windows,logs,api:context.probe,ready:()=>ready=true};
}
test('준비와 초기 등록이 끝나기 전 창 요청은 대기하고 완료 후 하나만 만든다',()=>{
 const f=fixture();assert.equal(f.api.ensure(),null);assert.equal(f.api.pending(),true);f.ready();f.app.emit('second-instance');assert.equal(f.windows.length,0);f.api.complete();f.api.ensure();assert.equal(f.windows.length,1);assert.equal(f.api.pending(),false);
});
test('창 생성 중 재진입과 반복 실행은 기존 창만 복원한다',()=>{
 const f=fixture({reentrant:true});f.ready();f.api.complete();f.api.ensure();assert.equal(f.windows.length,1);const first=f.api.current();first.minimized=true;first.visible=false;for(let i=0;i<3;i++)f.app.emit('second-instance');assert.equal(f.windows.length,1);assert.equal(first.minimized,false);assert.equal(first.visible,true);assert.equal(first.focuses,4);
});
test('마지막 창을 닫은 뒤 두 번째 실행과 활성화는 창을 다시 하나만 만든다',()=>{
 const f=fixture();f.ready();f.api.complete();f.api.ensure();f.api.current().close();assert.equal(f.api.current(),null);f.app.emit('second-instance');f.app.emit('activate');assert.equal(f.windows.length,2);assert.equal(f.windows.filter(row=>!row.destroyed).length,1);
});
test('종료를 시작한 뒤 활성화와 두 번째 실행은 새 창을 만들지 않는다',()=>{
 const f=fixture();f.ready();f.api.complete();f.api.ensure();f.api.current().close();f.api.quit();f.app.emit('activate');f.app.emit('second-instance');assert.equal(f.api.ensure(),null);assert.equal(f.windows.length,1);
});
test('선택 진단은 기본으로 꺼져 있고 단계와 창 상태만 출력한다',()=>{
 const off=fixture();off.ready();off.api.complete();off.api.ensure();assert.deepEqual(off.logs,[]);
 const on=fixture({diagnostics:true});on.api.ensure();on.ready();on.api.complete();on.api.ensure();const allowed=['creatingWindow','launchComplete','phase','quitting','ready','windowRequestPending','windows'].sort();assert(on.logs.length>0);for(const line of on.logs){assert(line.startsWith('[FlowriumLifecycle] '));const value=JSON.parse(line.slice('[FlowriumLifecycle] '.length));assert.deepEqual(Object.keys(value).sort(),allowed);assert.equal(typeof value.phase,'string');assert.equal(typeof value.windows,'number');for(const key of allowed.filter(key=>!['phase','windows'].includes(key)))assert.equal(typeof value[key],'boolean');}
});
