const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream');
const {registerMacPim}=require('../electron/mac-pim.cjs');
test('맥 기본 앱 연결은 직접 켜기 전 접근하지 않고 승인한 일정 개정을 한 번만 적용',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-native-pim-')),api={};let owner=1,version='one',writes=0,calls=[];
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const spawnImpl=(command,args)=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};let input='';
  child.stdin=new Writable({write(chunk,_,done){input+=chunk;done();},final(done){done();setImmediate(()=>{
   const value=JSON.parse(input);calls.push(value);assert(!args.some(a=>a.includes('사용자 일정')));let result;
   if(value.action==='calendars')result=[{id:'native',title:'내 일정',primary:true,writable:true}];
   if(value.action==='event')result={id:'event',title:'현재 일정',at:'2026-11-13T01:00:00Z',end:'2026-11-13T02:00:00Z',calendarId:'native',etag:version};
   if(['create','update','delete'].includes(value.action)){
    if(value.action!=='create'&&value.etag!==version){child.stdout.end(JSON.stringify({ok:false,error:'다른 곳에서 일정을 변경했습니다.'}));child.emit('close',0);return;}
    writes++;result={id:'event',title:value.summary};
   }
   child.stdout.end(JSON.stringify({ok:true,value:result}));child.emit('close',0);
  });}});return child;
 };
 registerMacPim((n,f)=>api[n]=f,{directory:dir,platform:'darwin',spawnImpl,accountRevision:()=>owner});
 await assert.rejects(api.macPim({action:'calendars'}),/켜 주세요/);assert.equal(calls.length,0);
 await api.configureMacPim(true);
 await assert.rejects(api.macPim({action:'send',to:'external@example.test'}),/지원/);
 const review=await api.prepareMacEvent({action:'update',calendarId:'native',eventId:'event',summary:'사용자 일정'});
 assert.equal(writes,0);assert.equal(review.event.title,'사용자 일정');
 await api.commitMacEvent(review.id);assert.equal(writes,1);await assert.rejects(api.commitMacEvent(review.id),/처리/);
 const stale=await api.prepareMacEvent({action:'delete',calendarId:'native',eventId:'event'});version='two';
 await assert.rejects(api.commitMacEvent(stale.id),/다른 곳/);assert.equal(writes,1);
 const oldOwner=await api.prepareMacEvent({action:'delete',calendarId:'native',eventId:'event'});owner=2;
 assert.equal((await api.macPimStatus()).enabled,false);await assert.rejects(api.commitMacEvent(oldOwner.id));assert.equal(writes,1);
});
test('Windows에서는 맥 전용 실행 파일과 메일 앱을 호출하지 않는다',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-native-unavailable-')),api={};t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 registerMacPim((n,f)=>api[n]=f,{directory:dir,platform:'win32',spawnImpl:()=>{throw Error('호출하면 실패');}});
 assert.equal((await api.macPimStatus()).available,false);await assert.rejects(api.configureMacPim(true),/Mac/);await assert.rejects(api.macPim({action:'calendars'}),/Mac/);
});
