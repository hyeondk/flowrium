const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {Store}=require('../electron/store.cjs'),{readDetails,updateDetails,registerProjectDetails}=require('../electron/project-details.cjs'),{registerProjectShortcuts,validateShortcuts}=require('../electron/project-shortcuts.cjs');
const {Migration,nativeSnapshot}=require('../electron/migration.cjs');
async function fixture(t){
 const base=path.resolve(__dirname,'../.flowrium-tmp/qa-261115_02');await fs.mkdir(base,{recursive:true});const temp=await fs.mkdtemp(path.join(base,'shortcuts-unit-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 const root=path.join(temp,'프로젝트 & 업무'),outside=path.join(temp,'외부 자료');await fs.mkdir(path.join(root,'자료'),{recursive:true});await fs.mkdir(outside);const store=new Store(path.join(temp,'profile'));await store.load();const project=await store.addProject(root);let revision=0,epoch=0,allowed=true,selection=path.join(root,'자료');const opened=[],api={};
 registerProjectDetails((n,f)=>api[n]=f,store);registerProjectShortcuts((n,f)=>api[n]=f,store,{accountRevision:()=>revision,stateEpoch:()=>epoch,canRun:()=>allowed,chooseDirectory:async()=>selection,openPath:async value=>opened.push(['folder',value]),openExternal:async value=>opened.push(['url',value])});
 return{temp,root,outside,store,project,api,opened,setSelection:value=>selection=value,setRevision:value=>revision=value,setEpoch:value=>epoch=value,setAllowed:value=>allowed=value,read:()=>readDetails(store,project.id)};
}
const link=(kind,target)=>({id:randomUUID(),kind,label:'프로젝트 연결',target});
test('운영 주소와 공식 Drive 폴더 / 선택한 내부·외부 폴더를 저장하고 재기동 뒤 같은 항목만 연다',async t=>{
 const f=await fixture(t),local=await f.api.projectShortcutAction(f.project.id,{action:'chooseLocal'});assert.equal(local.localMode,'relative');assert.equal(local.target,'자료');
 f.setSelection(f.outside);const external=await f.api.projectShortcutAction(f.project.id,{action:'chooseLocal'});assert.equal(external.localMode,'absolute');
 const rows=[link('operation','https://example.invalid/work?q=1'),link('drive','https://drive.google.com/drive/u/0/folders/folder_ID'),local,external];
 const data=await f.api.projectShortcutAction(f.project.id,{action:'save',revision:null,shortcuts:rows});assert.equal(data.shortcuts.length,4);
 for(const row of rows)assert.equal((await f.api.projectShortcutAction(f.project.id,{action:'open',id:row.id})).opened,true);
 assert.deepEqual(f.opened,[['url',rows[0].target],['url',rows[1].target],['folder',await fs.realpath(path.join(f.root,'자료'))],['folder',await fs.realpath(f.outside)]]);
 const restarted=new Store(path.join(f.temp,'profile'));await restarted.load();assert.deepEqual((await readDetails(restarted,f.project.id)).shortcuts,data.shortcuts);
 await assert.rejects(f.api.projectShortcutAction(f.project.id,{action:'open',id:randomUUID()}),/저장된/);
 const renamed=data.shortcuts.map(row=>({...row,label:'이름 수정'}));await f.api.projectShortcutAction(f.project.id,{action:'save',revision:data.revision,shortcuts:renamed});
 await assert.rejects(f.api.projectShortcutAction(f.project.id,{action:'save',revision:data.revision,shortcuts:[]}),/변경/);
});
test('잘못된 주소 / 직접 지정한 폴더 / 선택 후 잠금·계정 변경과 다른 프로젝트 재사용을 차단한다',async t=>{
 const f=await fixture(t);
 for(const row of [link('operation','file:///etc'),link('operation','https://user:pass@example.invalid'),link('drive','https://drive.google.com.evil.invalid/drive/folders/x'),link('drive','https://drive.google.com/file/d/x'),{...link('local','../외부 자료'),localMode:'relative'},{...link('local','.flowrium'),localMode:'relative'}])assert.throws(()=>validateShortcuts([row]));
 await assert.rejects(f.api.projectShortcutAction(f.project.id,{action:'save',revision:null,shortcuts:[{...link('local',f.outside),localMode:'absolute'}]}),/선택 버튼/);
 const selected=await f.api.projectShortcutAction(f.project.id,{action:'chooseLocal'});f.setRevision(1);await assert.rejects(f.api.projectShortcutAction(f.project.id,{action:'save',revision:null,shortcuts:[selected]}),/선택 버튼/);
 f.setAllowed(false);await assert.rejects(f.api.projectShortcutAction(f.project.id,{action:'chooseLocal'}),/잠금/);f.setAllowed(true);
 const another=await f.store.addProject(f.outside);await assert.rejects(f.api.projectShortcutAction(another.id,{action:'save',revision:null,shortcuts:[selected]}),/선택 버튼/);
 assert.throws(()=>f.api.updateProjectDetails(f.project.id,null,{action:'shortcuts',shortcuts:[]}),/바로가기 설정/);
 let release,state=0;const waiting=new Promise(resolve=>release=resolve),handlers={};registerProjectShortcuts((n,fn)=>handlers[n]=fn,f.store,{accountRevision:()=>1,stateEpoch:()=>state,canRun:()=>true,chooseDirectory:()=>waiting});
 const pending=handlers.projectShortcutAction(f.project.id,{action:'chooseLocal'});state++;release(f.outside);await assert.rejects(pending,/잠금 상태가 바뀌었습니다/);
});
test('저장한 폴더가 사라지거나 외부를 가리키는 연결로 바뀌면 실행하지 않고 실제 파일은 보존한다',async t=>{
 const f=await fixture(t),selected=await f.api.projectShortcutAction(f.project.id,{action:'chooseLocal'});let d=await f.api.projectShortcutAction(f.project.id,{action:'save',revision:null,shortcuts:[selected]});
 await fs.writeFile(path.join(f.root,'자료','보존.txt'),'원본');await fs.rename(path.join(f.root,'자료'),path.join(f.root,'원래 자료'));
 await assert.rejects(f.api.projectShortcutAction(f.project.id,{action:'open',id:selected.id}),/찾지 못/);assert.deepEqual(f.opened,[]);
 if(process.platform!=='win32'){await fs.symlink(f.outside,path.join(f.root,'자료'));await assert.rejects(f.api.projectShortcutAction(f.project.id,{action:'open',id:selected.id}),/위치/);}
 d=await f.api.projectShortcutAction(f.project.id,{action:'save',revision:d.revision,shortcuts:[]});assert.deepEqual(d.shortcuts,[]);assert.equal(await fs.readFile(path.join(f.root,'원래 자료','보존.txt'),'utf8'),'원본');
});
test('전체 이관과 카드 가져오기는 내부 경로를 새 프로젝트 기준으로 유지하고 외부 경로를 재선택 대상으로 보존한다',async t=>{
 const f=await fixture(t),relative=await f.api.projectShortcutAction(f.project.id,{action:'chooseLocal'});f.setSelection(f.outside);const absolute=await f.api.projectShortcutAction(f.project.id,{action:'chooseLocal'}),url=link('operation','https://example.invalid/project');
 await fs.writeFile(path.join(f.root,'자료','안내.txt'),'함께 옮길 파일');
 await f.api.projectShortcutAction(f.project.id,{action:'save',revision:null,shortcuts:[relative,absolute,url]});const source=await f.read(),snap=await nativeSnapshot(f.store,{includeFiles:true}),other=new Store(path.join(f.temp,'other-profile'));await other.load();const m=new Migration(other),plan=m.plan(snap,'import'),destination=path.join(f.temp,'이관된 프로젝트');m.plans.get(plan.id).targets[snap.projects.find(p=>p.id===f.project.id).key]=destination;
 const result=await m.action({action:'applyImport',id:plan.id,includeSettings:false});assert.equal(result.status,'completed');const loaded=new Store(path.join(f.temp,'other-profile'));await loaded.load();const p=loaded.state.projects.find(p=>p.path===destination),restored=await readDetails(loaded,p.id);assert.notEqual(restored.projectId,f.project.id);assert.equal(restored.shortcuts[0].target,'자료');assert.equal(restored.shortcuts[0].disabled,undefined);assert.equal(restored.shortcuts[1].target,absolute.target);assert.equal(restored.shortcuts[1].disabled,true);assert.equal(restored.shortcuts[2].target,url.target);
 const handlers={},opened=[];registerProjectShortcuts((n,fn)=>handlers[n]=fn,loaded,{openPath:async p=>opened.push(p)});await handlers.projectShortcutAction(p.id,{action:'open',id:relative.id});assert.deepEqual(opened,[await fs.realpath(path.join(destination,'자료'))]);await assert.rejects(handlers.projectShortcutAction(p.id,{action:'open',id:absolute.id}),/이관한/);assert.deepEqual(await f.read(),source);
 const imported=await updateDetails(f.store,f.project.id,source.revision,{action:'import',data:source});assert.equal(imported.shortcuts[1].disabled,true);assert.equal(imported.shortcuts[0].target,'자료');
});
