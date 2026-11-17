const {addTrustedFixtureProject} = require('./project-trust-fixture.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {Store} = require('../electron/store.cjs');
const {Controller} = require('../electron/controller.cjs');
const {CodexClient,resolveCodex} = require('../electron/codex.cjs');

async function main() {
  const {originalAnswerFollowups} = await import('../electron/mobile/answer-followup.js');
  const dir = await fs.mkdtemp(path.resolve(__dirname,'../.flowrium-tmp/continuation-native-'));
  const profile = path.join(dir,'codex');
  const projectDir = path.join(dir,'검색');
  const answer = '검색 결과를 확인했습니다. 한글 검색어의 회귀 검사를 진행할까요?';
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
      const item={id:'answer-'+calls.length,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};
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
    client = new CodexClient({descriptor,spawn:(cmd,args,options)=>spawn(cmd,[...args,'-c','model_provider="flowrium_test"'],{
      ...options,env:{...options.env,CODEX_HOME:profile,FLOWRIUM_OFFLINE_KEY:'synthetic-local-only',OPENAI_BASE_URL:base},
    })});
    const request=client.request.bind(client);
    client.request=(method,params,...rest)=>method==='account/read'
      ? Promise.resolve({account:{type:'chatgpt',planType:'test'}}) : request(method,params,...rest);
    const store = new Store(path.join(dir,'local'));
    await store.load();
    const project = await addTrustedFixtureProject(store, projectDir);
    const session = await store.createSession(project.id);
    await store.saveSettings({model:'gpt-5.5'});
    controller=new Controller(store,{client,canRun:()=>true,analysisClientFactory:()=>{
      analysisClients++; throw Error('추천에서 독립 분석 모델을 호출했습니다.');
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
    for(let i=0;i<3;i++){
      assert.equal(originalAnswerFollowups(latest)[0]?.prompt,'한글 검색어의 회귀 검사를 진행해줘');
    }
    assert.equal(expectedTokens-before,0);
    assert.equal(calls.length,1);
    assert.equal(controller.runs.size,0);
    assert.equal(analysisClients,0);
    assert.equal(JSON.stringify(latest.messages),snapshot);
    console.log('내장 Codex의 사용자 전송 1회 / 실제 답변에서 제안 추출 / 추천 자체의 추가 요청 0회·토큰 0개 / 저장된 대화 원본 보존');
  } finally {
    if(controller) await controller.shutdown(); else client?.close();
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await fs.rm(dir,{recursive:true,force:true,maxRetries:6,retryDelay:100});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
