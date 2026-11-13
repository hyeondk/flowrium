const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Store}=require('../electron/store.cjs'),{registerStorageTools}=require('../electron/storage-tools.cjs');
test('정리 계획은 실행 중 자료를 제외하고 오래된 대화를 압축 보관한 뒤 원래 대화와 개정을 복원한다',async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-storage-'));t.after(()=>fs.rm(temp,{recursive:true,force:true,maxRetries:4,retryDelay:100}));const dir=path.join(temp,'프로젝트');await fs.mkdir(dir);const store=new Store(path.join(temp,'profile'));await store.load();const p=await store.addProject(dir),old=await store.createSession(p.id),live=await store.createSession(p.id);const at=new Date(Date.now()-40*86400000).toISOString();for(const id of [old.id,live.id]){store.session(id).updatedAt=at;store.session(id).messages.push({id:require('node:crypto').randomUUID(),role:'assistant',text:'보관할 내용 '+id,createdAt:at});}await store.save();
 const api={};registerStorageTools((n,f)=>api[n]=f,store,{isRunning:id=>id===live.id,getTeamRuns:async()=>[]});
 const report=await api.storageAction({action:'report'});assert.equal(report.sessionCount,2);assert(report.total>0);
 const plan=await api.storageAction({action:'plan',days:30,kinds:['sessions','attachments']});assert.deepEqual(plan.sessions.map(s=>s.id),[old.id]);
 await api.storageAction({action:'apply',id:plan.id});assert.equal(store.state.sessions.length,1);assert.equal(store.state.sessions[0].id,live.id);
 assert.equal((await fs.readdir(path.join(dir,'.flowrium','sessions'))).some(n=>n.startsWith(old.id+'--')),false);
 await api.storageAction({action:'restore',id:plan.id});assert.equal(store.state.sessions.length,2);assert.equal(store.session(old.id).messages[0].text,'보관할 내용 '+old.id);
 const reloaded=new Store(path.join(temp,'profile'));await reloaded.load();assert.equal(reloaded.session(old.id).messages.length,1);
});
