const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs/promises"),path=require("node:path"),os=require("node:os");
const {Store}=require("../electron/store.cjs"),{registerMemory}=require("../electron/memory.cjs");
async function setup(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"flowrium-memory-transfer-"));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
  const store=new Store(path.join(root,"설정"));await store.load();const dir=path.join(root,"프로젝트");await fs.mkdir(dir);const project=await store.addProject(dir);let owner=0;
  const api={};registerMemory((key,fn)=>api[key]=fn,store,{accountRevision:()=>owner});return{project,api,changeAccount:()=>owner++};
}
const note={action:"save",revision:null,scope:"project",title:"기준",body:"원래 내용",role:"",link:"",linked:true};
test("메모 묶음은 선택 적용하고 덮어쓴 메모의 이전 개정을 보존하며 범위 이동도 원본을 복원할 수 있다",async t=>{
  const {api,project}=await setup(t);const first=await api.changeMemory(project.id,note);
  const bundle=await api.exportMemory(project.id);assert.equal(bundle.notes[0].history.length,1);
  bundle.notes[0].body="가져온 새 내용";bundle.notes.push({...bundle.notes[0],title:"추가 메모",body:"두 번째 내용"});
  const plan=await api.previewMemoryImport(project.id,bundle,"project");assert.deepEqual(plan.entries.map(n=>n.action),["update","create"]);
  const result=await api.applyMemoryImport(project.id,plan.id,[plan.entries[0].key]);assert.equal(result.backups,1);assert.equal(result.notes.length,1);
  assert.equal((await api.listMemory(project.id)).length,1);
  const history=await api.memoryVersions(project.id,"project",first.id);assert.equal(history[0].body,"가져온 새 내용");assert.equal(history[1].body,"원래 내용");
  const moved=await api.moveMemory(project.id,{id:first.id,scope:"project",revision:history[0].rev,to:"personal"});assert.equal(moved.sourceRetained,false);
  const rows=await api.listMemory(project.id);assert(rows.some(n=>n.scope==="project"&&n.deleted));assert(rows.some(n=>n.scope==="personal"&&!n.deleted));
  const sourceHistory=await api.memoryVersions(project.id,"project",first.id);await api.changeMemory(project.id,{action:"restore",scope:"project",id:first.id,revision:sourceHistory[0].rev,target:first.rev});
  assert((await api.listMemory(project.id)).some(n=>n.id===first.id&&!n.deleted&&n.body==="원래 내용"));
});
test("메모 가져오기는 미리보기 이후의 변경과 계정 교체 및 잘못된 묶음·선택을 거절한다",async t=>{
  const {api,project,changeAccount}=await setup(t);const row=await api.changeMemory(project.id,note),bundle=await api.exportMemory(project.id);
  let plan=await api.previewMemoryImport(project.id,bundle,"project");await api.changeMemory(project.id,{...note,id:row.id,revision:row.rev,body:"미리보기 뒤 변경"});
  await assert.rejects(api.applyMemoryImport(project.id,plan.id,plan.entries.map(n=>n.key)),/바뀌|동기화|변경/);
  plan=await api.previewMemoryImport(project.id,bundle,"project");changeAccount();await assert.rejects(api.applyMemoryImport(project.id,plan.id,plan.entries.map(n=>n.key)));
  await assert.rejects(api.previewMemoryImport(project.id,{...bundle,notes:[...bundle.notes,...bundle.notes]},"project"),/같은 제목/);
  await assert.rejects(api.previewMemoryImport(project.id,{...bundle,notes:[{...bundle.notes[0],link:"file:///etc/passwd"}]},"project"));
  assert.equal((await api.listMemory(project.id))[0].body,"미리보기 뒤 변경");
});
