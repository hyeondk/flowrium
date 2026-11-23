const {addTrustedFixtureProject} = require('./project-trust-fixture.cjs');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {Store} = require('../electron/store.cjs');
const {Controller} = require('../electron/controller.cjs');
const {CodexClient,resolveCodex} = require('../electron/codex.cjs');
const {createFollowupGenerator} = require('../electron/followup-generator.cjs');

async function main() {
  const {originalAnswerFollowups} = await import('../electron/mobile/answer-followup.js');
  const dir = await fs.mkdtemp(path.resolve(__dirname,'../.flowrium-tmp/continuation-native-'));
  const profile = path.join(dir,'codex');
  const projectDir = path.join(dir,'검색');
  const answer = '검색 결과를 확인했습니다. 한글 검색어의 회귀 검사를 진행할까요?';
  const evidence = '한글 검색어의 회귀 검사';
  const candidate = '한글 검색어와 빈 검색어로 검색을 각각 재현해 두 입력에서 결과 개수 표시가 맞는지 확인해줘.';
  const account = {type:'chatgpt',planType:'test',email:'flowrium-fixture@example.invalid'};
  const owner = createHash('sha256').update('flowrium-account:' + account.email).digest('hex');
  const calls = [];
  let controller,server,client,expectedTokens=0,analysisClients=0;
  try {
    await fs.mkdir(profile);
    await fs.mkdir(projectDir);
    server = http.createServer(async(req,res)=>{
      if(req.method!=='POST' || !req.url.startsWith('/v1/responses')) return res.writeHead(404).end();
      const chunks=[];
      for await(const chunk of req) chunks.push(chunk);
      calls.push(JSON.parse(Buffer.concat(chunks)));
      const id='native-followup-'+calls.length;
      const response=calls.length===1 ? answer : JSON.stringify({suggestions:[{prompt:candidate,evidence}]});
      const item={id:'answer-'+calls.length,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:response,annotations:[]}]};
      const usage={input_tokens:20,output_tokens:12,total_tokens:32};
      expectedTokens+=usage.total_tokens;
      const events=[
        {type:'response.created',response:{id,status:'in_progress'}},
        {type:'response.output_item.added',output_index:0,item:{...item,content:[]}},
        {type:'response.output_item.done',output_index:0,item},
        {type:'response.completed',response:{id,status:'completed',output:[item],usage}},
      ];
      res.writeHead(200,{'Content-Type':'text/event-stream'}).end(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base='http://127.0.0.1:'+server.address().port+'/v1';
    await fs.writeFile(path.join(profile,'config.toml'),[
      'cli_auth_credentials_store = "file"','model = "gpt-5.5"','[model_providers.flowrium_test]',
      'name = "Flowrium local test"','base_url = '+JSON.stringify(base),'wire_api = "responses"',
      'env_key = "FLOWRIUM_OFFLINE_KEY"','supports_websockets = false','[analytics]','enabled = false','',
    ].join('\n'));
    const descriptor = await resolveCodex();
    assert(descriptor);
    const makeClient=configOverrides=>{
      const instance=new CodexClient({descriptor,configOverrides,spawn:(cmd,args,options)=>spawn(cmd,[...args,'-c','model_provider="flowrium_test"'],{
        ...options,env:{...options.env,CODEX_HOME:profile,FLOWRIUM_OFFLINE_KEY:'synthetic-local-only',OPENAI_BASE_URL:base},
      })});
      const request=instance.request.bind(instance);
      instance.request=(method,params,...rest)=>method==='account/read'
        ? Promise.resolve({account}) : request(method,params,...rest);
      return instance;
    };
    client=makeClient();
    const store = new Store(path.join(dir,'local'));
    await store.load();
    const project = await addTrustedFixtureProject(store, projectDir);
    const session = await store.createSession(project.id);
    await store.saveSettings({model:'gpt-5.5'});
    controller=new Controller(store,{client,canRun:()=>true,modelAccount:()=>owner,analysisClientFactory:overrides=>{
      analysisClients++; return makeClient(overrides);
    }});
    await controller.connect();
    let stop;
    const completed=new Promise((resolve,reject)=>{
      const handle=event=>{
        if(event.type==='done' && event.sessionId===session.id){
          stop();
          if(event.status==='completed')resolve(); else reject(Error(event.text));
        }
      };
      const timer=setTimeout(()=>{stop();reject(Error('사용자 전송 완료 시간 초과'));},20000);
      stop=()=>{clearTimeout(timer);controller.off('event',handle);};
      controller.on('event',handle);
    });
    try {
      await Promise.all([completed,controller.send({sessionId:session.id,text:'한글 검색 결과를 확인해줘',mode:'plan'},{fromComposer:true})]);
    } finally { stop(); }
    const latest=store.session(session.id);
    assert.equal(latest.messages.at(-1).text,answer);
    assert.equal(calls.length,1);
    assert.doesNotMatch(JSON.stringify(calls[0].input),/미완료 작업/);
    const snapshot=JSON.stringify(latest.messages);
    const before=expectedTokens;
    let modelFollowupsEnabled=false;
    const generator=createFollowupGenerator(controller,{canRun:()=>modelFollowupsEnabled});
    for(let i=0;i<3;i++){
      assert.equal(originalAnswerFollowups(latest)[0]?.prompt,'한글 검색어의 회귀 검사를 진행해줘');
      assert.equal(await generator.recommend(latest.id,latest.messages.at(-1).id),null);
    }
    assert.equal(expectedTokens-before,0);
    assert.equal(calls.length,1);
    assert.equal(controller.runs.size,0);
    assert.equal(analysisClients,0);
    assert.equal(JSON.stringify(latest.messages),snapshot);
    modelFollowupsEnabled=true;
    const answerId=latest.messages.at(-1).id;
    const generated=await generator.recommend(latest.id,answerId);
    assert.equal(generated?.prompt,candidate);
    assert.deepEqual(await generator.recommend(latest.id,answerId),generated);
    assert.equal(calls.length,2);
    assert.equal(analysisClients,1);
    const serialized=JSON.stringify(calls[1].input);
    assert(serialized.includes('놓친 검증') && serialized.includes(evidence),'추천 전용 지시와 최근 대화의 실제 근거가 함께 모델에 도달해야 합니다.');
    const tools=(calls[1].tools||[]).flatMap(item=>item.tools?.map(tool=>tool.name)||[item.name||item.type]);
    for(const name of ['exec_command','write_stdin','shell','spawn_agent','web_search','flowrium_memory_save'])assert(!tools.includes(name));
    assert.equal(JSON.stringify(latest.messages),snapshot);
    assert.equal(controller.editingSessions.size,0);
    assert.equal(controller.runs.size,0);
    assert.equal(client.ready,true);
    generator.invalidate();
    console.log('내장 Codex 사용자 전송 / 기본 추천 모델 요청 0회 / 설정을 켰을 때 격리 모델 요청 1회와 명령 생성 / 도구 제외 / 저장된 대화와 기본 연결 보존');
  } finally {
    if(controller) await controller.shutdown(); else client?.close();
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await fs.rm(dir,{recursive:true,force:true,maxRetries:6,retryDelay:100});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
