const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Store}=require('../electron/store.cjs'),{registerPortfolio}=require('../electron/portfolio.cjs'),{registerProjectDetails}=require('../electron/project-details.cjs');
async function setup(t){const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-pf-extended-'));t.after(()=>fs.rm(temp,{recursive:true,force:true,maxRetries:4,retryDelay:100}));const dir=path.join(temp,'프로젝트');await fs.mkdir(dir);const store=new Store(path.join(temp,'profile'));await store.load();const project=await store.addProject(dir),api={};registerPortfolio((n,f)=>api[n]=f,store,{chooseFolder:async()=>dir,reveal:async()=>{}});registerProjectDetails((n,f)=>api[n]=f,store);return {temp,dir,store,project,api};}
test('프로젝트 보드 순서와 칸, 단축키를 보존하고 중복 키 및 오래된 변경을 차단한다',async t=>{
 const f=await setup(t),s=await f.api.portfolioAction({action:'read'});
 const next=await f.api.portfolioAction({action:'save',revision:s.revision,order:[f.project.id],columns:[...s.columns].reverse(),shortcuts:{search:'mod+shift+k'}});
 assert.equal((await f.api.portfolioAction({action:'read'})).revision,next.revision);
 await assert.rejects(f.api.portfolioAction({action:'save',revision:null,order:[]}),/변경/);
 await assert.rejects(f.api.portfolioAction({action:'save',revision:next.revision,shortcuts:{settings:'mod+shift+k',search:'mod+shift+k'}}),/단축키/);
 assert.equal((await f.api.portfolioAction({action:'read'})).shortcuts.search,'mod+shift+k');
});
test('목표의 상위 연결과 수치 진척·이월·반복 일정, 여러 저장소를 개정 충돌 없이 저장한다',async t=>{
 const f=await setup(t),api=f.api,id=f.project.id;let d=await api.readProjectDetails(id);
 d=await api.updateProjectDetails(id,d.revision,{action:'goal-add',period:'month',key:'2026-11',text:'발간',target:10,due:'2026-11-30'});const monthly=d.periodGoals[0].id;
 d=await api.updateProjectDetails(id,d.revision,{action:'goal-progress',id:monthly,current:4});assert.equal(d.periodGoals[0].current,4);
 d=await api.updateProjectDetails(id,d.revision,{action:'goal-add',period:'week',key:'2026-11-09',text:'초안',parent:monthly});
 const before=d.revision;d=await api.updateProjectDetails(id,d.revision,{action:'goal-carry',id:d.periodGoals[1].id,key:'2026-11-16'});assert.equal(d.periodGoals[2].carriedFrom,d.periodGoals[1].id);
 await assert.rejects(api.updateProjectDetails(id,before,{action:'goal-check',id:monthly,done:true}),/변경/);
 await assert.rejects(api.updateProjectDetails(id,d.revision,{action:'goal-progress',id:monthly,current:-1}),/형식/);assert.equal((await api.readProjectDetails(id)).periodGoals[0].current,4);
 const schedule=[{id:require('node:crypto').randomUUID(),day:1,time:'09:10',text:'검토'}];d=await api.updateProjectDetails(id,d.revision,{action:'schedule',entries:schedule});assert.deepEqual(d.schedule,schedule);
 await fs.mkdir(path.join(f.dir,'front'));await fs.mkdir(path.join(f.dir,'api'));
 const repositories=['front','api'].map(name=>({id:require('node:crypto').randomUUID(),name,path:name,github:'',account:'',base:'main'}));
 d=await api.updateProjectDetails(id,d.revision,{action:'repositories',repositories,chatCwd:'front'});
 const helper=require('../electron/project-repositories.cjs');assert.equal(await helper.resolveProjectDirectory(f.store,f.project),await fs.realpath(path.join(f.dir,'front')));
 assert.equal((await helper.repositoriesFor(f.store,f.project)).length,2);
 await assert.rejects(api.updateProjectDetails(id,d.revision,{action:'repositories',repositories:[{...repositories[0],path:'../outside'}],chatCwd:'.'}),/형식/);
});
test('카드 가져오기는 미리보기 선택과 덮어쓰기 확인을 요구하고 기존 정보를 백업한다',async t=>{
 const f=await setup(t),id=f.project.id;let d=await f.api.readProjectDetails(id);d=await f.api.updateProjectDetails(id,d.revision,{action:'details',owner:'원본 담당자',goal:'원본 목표',dueDate:''});
 const exported=await f.api.portfolioAction({action:'export'});assert.equal(exported.cards[0].folderHint,'프로젝트');assert.equal(JSON.stringify(exported).includes(f.temp),false);
 exported.cards[0].details.owner='수정 담당자';const preview=await f.api.portfolioAction({action:'previewImport',text:JSON.stringify(exported)});
 await assert.rejects(f.api.portfolioAction({action:'applyImport',token:preview.token,selected:[0],overwrite:false}),/덮어쓰기/);
 assert.equal((await f.api.readProjectDetails(id)).owner,'원본 담당자');
 await f.api.portfolioAction({action:'applyImport',token:preview.token,selected:[0],overwrite:true});assert.equal((await f.api.readProjectDetails(id)).owner,'수정 담당자');
 const backups=await fs.readdir(path.join(f.temp,'profile','portfolio-backups'));assert.equal(backups.length,1);assert.equal(JSON.parse(await fs.readFile(path.join(f.temp,'profile','portfolio-backups',backups[0]))).details.owner,'원본 담당자');
 exported.cards[0].details.repositories=[{id:require('node:crypto').randomUUID(),name:'외부',path:'/outside'}];await assert.rejects(f.api.portfolioAction({action:'previewImport',text:JSON.stringify(exported)}),/형식/);
});
