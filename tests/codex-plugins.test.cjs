const assert=require('node:assert/strict');
const test=require('node:test');
const {allowedAppUrl,checkedReferences,mentionInputs,registerCodexPlugins}=require('../electron/codex-plugins.cjs');

const market='openai-curated-remote';
const packageRow=(name,properties={})=>({pluginId:name+'@'+market,name,marketplaceName:market,
  source:{source:'remote'},installPolicy:'AVAILABLE',installed:false,enabled:false,...properties});
const app={kind:'app',id:'connector_work',name:'업무 일정'};
function fixture() {
  const handlers={},commands=[],browser=[],rpc=[];
  let context='current', completed=false;
  const installed=packageRow('spreadsheets',{installed:true,enabled:true});
  const available=packageRow('shared-work');
  const local=packageRow('local-preview',{source:{source:'git',url:'https://untrusted.invalid/repo'}});
  const disabled=packageRow('blocked',{installPolicy:'NOT_AVAILABLE'});
  const runtime=registerCodexPlugins((name,handler)=>{handlers[name]=handler;},{
    directory:'/test/app-data',getContext:()=>context,openExternal:async url=>{browser.push(url);},
    controller:{store:{state:{settings:{}}},client:{descriptor:{command:'/runtime/codex',prefix:[]},start:async()=>{},
      request:async (method,params)=>{
        rpc.push(method);
        if(method==='account/read')return {account:{type:'chatgpt'}};
        if(method==='app/installed')return {apps:[
          {id:app.id,runtimeName:app.name,enabled:true,callable:true},
          {id:'untouchable',runtimeName:'권한이 없는 앱',enabled:true,callable:false},
        ]};
        if(method==='app/list')return {data:[
          {id:'cloud-work', name:'Shared Work', pluginDisplayNames:['Shared Work'],
            isAccessible:false,isEnabled:true,installUrl:'https://chatgpt.com/apps/shared-work/cloud-work'},
        ]};
        if(method==='app/read')return {apps:[{id:params.appIds[0],installUrl:'javascript:alert(1)'}]};
        throw Error('unexpected rpc: '+method);
      },
    }},
    execute:async (descriptor,directory,args)=>{
      assert.equal(descriptor.command,'/runtime/codex');
      assert.equal(directory,'/test/app-data');
      commands.push(args);
      if(args[0]==='list')return {installed:[installed,...(completed?[{...available,installed:true,enabled:true}]:[])],
        available:args.includes('--available')?[available,local,disabled]:[]};
      assert.deepEqual(args,['add','shared-work@'+market,'--json']);
      completed=true;
      return {pluginId:available.pluginId,authPolicy:'ON_INSTALL'};
    },
  });
  return {...handlers,...runtime,commands,browser,rpc,switchAccount(next){context=next;runtime.invalidate();}};
}

test('설치한 플러그인과 호출 가능한 앱만 정확한 식별자로 모델에 전달한다',async()=>{
  const f=fixture();
  const result=await f.readCodexPlugins({view:'suggestions'});
  assert.deepEqual(result.rows.map(row=>row.name),[app.name,'Spreadsheets']);
  assert.equal(result.rows.some(row=>Object.hasOwn(row,'source')),false);
  const selected=await f.resolve([{...app,name:'위조 표시명'},{kind:'plugin',id:'spreadsheets@'+market,name:'시트'}]);
  assert.deepEqual(mentionInputs(selected),[
    {type:'mention',name:app.name,path:'app://connector_work'},
    {type:'mention',name:'Spreadsheets',path:'plugin://spreadsheets@'+market},
  ]);
  await assert.rejects(f.resolve([{kind:'app',id:'untouchable',name:'권한 없는 앱'}]),/사용할 수 없는 도구/);
  await assert.rejects(f.resolve([{kind:'app',id:'arbitrary',name:'미등록'}]),/사용할 수 없는 도구/);
  assert.throws(()=>checkedReferences([{...app,id:'https://untrusted.invalid/a'}]),/다시 선택/);
  assert.throws(()=>checkedReferences([{kind:'plugin',id:'--version@market',name:'위조'}]),/다시 선택/);
  assert.throws(()=>checkedReferences(Array(9).fill(app)),/최대 8개/);
});

test('공식 CLI가 반환한 관리 가능한 플러그인만 재검증하고 명시 승인 후 설치한다',async()=>{
  const f=fixture();
  const result=await f.readCodexPlugins({view:'available',search:'work'});
  const remote=result.rows.find(row=>row.kind==='plugin');
  assert.equal(remote.install,'direct');
  const {kind,id}=remote;
  await assert.rejects(f.manageCodexPlugin({action:'install',kind,id}),/설치 내용을 확인/);
  await assert.rejects(f.manageCodexPlugin({action:'install',kind,id:'fake@'+market,confirmed:true}),/목록을 다시 조회/);
  const other=await f.readCodexPlugins({view:'available',search:'local-preview'});
  assert.equal(other.rows[0].install,'official');
  await assert.rejects(f.manageCodexPlugin({action:'install',kind,id:'local-preview@'+market,confirmed:true}),/설치 내용을 확인/);
  assert.deepEqual(await f.manageCodexPlugin({action:'install',kind,id,confirmed:true}),{installed:true,authRequired:true});
  assert.deepEqual(f.commands.slice(-2),[['list','--available','--json','--marketplace',market],['add','shared-work@'+market,'--json']]);
  const restored=await f.readCodexPlugins({view:'catalog'});
  assert.ok(restored.rows.some(row=>row.id===id&&row.installed));
  assert.ok(f.rpc.every(method=>!method.startsWith('plugin/')));
});

test('권한 연결은 공식 ChatGPT 주소만 열고 계정 전환 뒤 오래된 목록을 사용할 수 없다',async()=>{
  const f=fixture();
  await f.readCodexPlugins({view:'available',search:'shared work'});
  await f.manageCodexPlugin({action:'connect',kind:'app',id:'cloud-work',appId:'cloud-work'});
  assert.deepEqual(f.browser,['https://chatgpt.com/apps/shared-work/cloud-work']);
  assert.equal(allowedAppUrl('https://chatgpt.com.evil.invalid/apps/fake'),null);
  assert.equal(allowedAppUrl('https://chatgpt.com:8080/apps/fake'),null);
  assert.equal(allowedAppUrl('https://user@chatgpt.com/apps/fake'),null);
  assert.equal(allowedAppUrl('https://chatgpt.com/apps/../backend-api/unknown'),null);
  f.switchAccount('second');
  await assert.rejects(f.manageCodexPlugin({action:'install',kind:'plugin',id:'shared-work@'+market,confirmed:true}),/목록을 다시 조회/);
  f.switchAccount(null);
  await assert.rejects(f.readCodexPlugins({view:'suggestions'}),/잠금 상태/);
});
