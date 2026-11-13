const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {_electron}=require('playwright');const {Store}=require('../electron/store.cjs');
async function main(createNew=false){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-voice-dialogue-')),profile=path.join(temp,'profile'),folder=path.join(temp,'project');
  let app,page,server,calls=0,ttsCalls=0,answers=['플로리움, 먼저 검토할 요청','플로리움, 다음 검토할 요청','다른 대화에는 호출어가 없습니다','플로리움, 자동 전송 검증 요청'],pendingResponse=null,hold=false;
  try{
    const {pcmWav}=await import('../shared/voice-activity.ts'),audio=Buffer.from(pcmWav(new Float32Array(48000).fill(.01)));
    server=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
      if(req.url==='/tts'){ttsCalls++;assert.equal(JSON.parse(bytes).text.length>0,true);res.setHeader('Content-Type','audio/wav');res.end(audio);return;}
      assert.equal(req.url,'/inference');assert.ok(bytes.includes(Buffer.from('RIFF')));assert.equal(req.headers.authorization,undefined);calls++;
      if(hold){pendingResponse=res;return;}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({text:answers.shift()||'플로리움, 추가 음성 요청'}));
    });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const endpoint=`http://127.0.0.1:${server.address().port}`,store=new Store(profile);await store.load();await fs.mkdir(folder);const project=await store.addProject(folder);if(!createNew)await store.createSession(project.id,{title:'연속 음성 검증 대화'});await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
    const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
    app=await _electron.launch({args:[path.resolve(__dirname,'..')],env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(18000);
    const button=name=>page.getByRole('button',{name,exact:true}),composer=()=>page.getByLabel('Codex에 보낼 작업 요청');
    if(createNew)await button('새 자유 대화').click();else await page.locator('.pf-row').filter({hasText:'연속 음성 검증 대화'}).click();await composer().waitFor();
    await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('flowrium:allowVoiceCapture');ipcMain.handle('flowrium:allowVoiceCapture',()=>true);});
    await page.evaluate(()=>{
      window.voiceTest={stopped:0,contexts:[],streams:[],plays:0,paused:0};
      const node=()=>({connect(){},disconnect(){},gain:{value:0}});
      window.AudioContext=class{constructor(){this.sampleRate=16000;this.state='running';window.voiceTest.contexts.push(this);}createMediaStreamSource(){return node();}createGain(){return node();}createScriptProcessor(){this.processor={...node(),onaudioprocess:null};return this.processor;}get destination(){return node();}async resume(){}async close(){this.state='closed';}};
      Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{const track=new EventTarget();track.readyState='live';track.stop=()=>{if(track.readyState!=='ended'){track.readyState='ended';window.voiceTest.stopped++;}};const media={getTracks:()=>[track]};window.voiceTest.streams.push(media);return media;}});
      const originalQuery=navigator.permissions.query.bind(navigator.permissions);navigator.permissions.query=async descriptor=>{if(descriptor.name!=='microphone')return originalQuery(descriptor);const permission=new EventTarget();permission.state='granted';return permission;};
      const NativeAudio=window.Audio;window.Audio=function(...arguments_){const player=new NativeAudio(...arguments_);player.muted=true;const play=player.play.bind(player),pause=player.pause.bind(player);player.play=async()=>{await play();window.voiceTest.plays++;};player.pause=()=>{pause();window.voiceTest.paused++;};return player;};
      window.voiceTest.segment=()=>{const context=window.voiceTest.contexts.at(-1),send=level=>{context.processor.onaudioprocess?.({inputBuffer:{getChannelData:()=>new Float32Array(2048).fill(level)}});};for(let i=0;i<2;i++)send(.001);for(let i=0;i<4;i++)send(.12);for(let i=0;i<9;i++)send(.001);};
    });
    await button('설정').click();await page.getByLabel('음성 인식 방식').selectOption('local');await page.getByLabel('로컬 인식 서버 주소').fill(endpoint);await page.getByLabel('연속 듣기 사용',{exact:true}).check();assert.equal(await page.getByLabel('호출어 뒤 요청을 ChatGPT에 바로 전송',{exact:true}).isChecked(),false);await button('음성 설정 저장').click();await page.getByRole('status').filter({hasText:'음성 설정을 저장'}).waitFor();await button('설정 닫기').click();
    await button('음성으로 입력').click();await button('녹음 끝내기').waitFor();await page.evaluate(()=>{window.voiceTest.segment();window.voiceTest.segment();});
    await page.waitForFunction(()=>document.querySelector('[aria-label="Codex에 보낼 작업 요청"]').value.includes('다음 검토할 요청'));
    assert.equal(await composer().inputValue(),'먼저 검토할 요청\n다음 검토할 요청');let state=await page.evaluate(()=>window.flowrium.bootstrap());assert.equal(state.sessions.every(session=>session.messages.length===0),true);assert.equal(calls,2);
    await page.evaluate(()=>window.voiceTest.segment());await page.getByRole('status').filter({hasText:'호출어를 기다리는 중'}).waitFor();assert.equal(await composer().inputValue(),'먼저 검토할 요청\n다음 검토할 요청');
    const before=await page.evaluate(()=>window.voiceTest.stopped);await button('설정').click();await page.waitForFunction(value=>window.voiceTest.stopped>value,before);
    await page.getByLabel('호출어 뒤 요청을 ChatGPT에 바로 전송',{exact:true}).check();await page.getByLabel('답변 읽기 방식').selectOption('local');await page.getByLabel('로컬 읽기 서버 주소').fill(endpoint);await page.getByLabel('기준 음성 경로').fill('/test/server/reference.wav');await button('음성 설정 저장').click();await page.getByRole('status').filter({hasText:'음성 설정을 저장'}).waitFor();await button('설정 닫기').click();
    await composer().fill('');await button('음성으로 입력').click();await button('녹음 끝내기').waitFor();await page.evaluate(()=>window.voiceTest.segment());
    await page.waitForFunction(async()=>{const state=await window.flowrium.bootstrap();return state.sessions.some(session=>session.messages.some(message=>message.role==='user'&&message.text==='자동 전송 검증 요청'));});
    await page.getByText('확인한 결과입니다.',{exact:false}).first().waitFor();await button('녹음 끝내기').waitFor();
    assert.equal(await page.evaluate(()=>window.voiceTest.contexts.filter(context=>context.state==='running').length),1);
    await button('답변 읽어주기').first().click();await page.waitForFunction(()=>window.voiceTest.plays===1);assert.equal(ttsCalls,1);await button('읽기 중단').first().click();assert.equal(await page.evaluate(()=>window.voiceTest.paused),1);
    hold=true;await page.evaluate(()=>window.voiceTest.segment());while(!pendingResponse)await new Promise(resolve=>setTimeout(resolve,10));const oldDraft=await composer().inputValue();await button('대시보드').click();await page.getByRole('heading',{name:'프로젝트 대시보드',exact:true}).waitFor();pendingResponse.end(JSON.stringify({text:'플로리움, 화면을 떠난 뒤 전달 금지'}));pendingResponse=null;
    assert.equal(await page.evaluate(()=>window.voiceTest.contexts.filter(context=>context.state==='running').length),0);await page.waitForTimeout(100);
    state=await page.evaluate(()=>window.flowrium.bootstrap());assert.equal(state.sessions.some(session=>session.messages.some(message=>message.text.includes('화면을 떠난 뒤 전달 금지'))),false);assert.equal(oldDraft,'');
    await button('설정').click();assert.equal(await page.getByLabel('호출어 뒤 요청을 ChatGPT에 바로 전송',{exact:true}).isChecked(),true);for(const width of [390,768,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}await button('설정 닫기').click();
    console.log(`${createNew?'첫 자유 대화':'기존 대화'} / 로컬 음성 실제 HTTP·WAV / 연속 구간 순서와 검토 기본값 / 호출어 없는 말 무시 / 설정 이동 스트림 해제 / 명시 자동 전송과 실제 모델 답변·듣기 재개 / 로컬 읽기 재생·중단 / 화면 이동 뒤 늦은 전사 폐기 / 설정 보존 / 반응형 통과`);
  }catch(error){if(page&&!page.isClosed())console.error('음성 화면 진단',await page.locator('body').innerText().catch(()=>''));throw error;}
  finally{if(app)await app.close();if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await fs.rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:150});}
}
(async()=>{await main(false);await main(true);})().catch(error=>{console.error(error);process.exitCode=1;});
