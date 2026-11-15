// 화면 회귀 전용 모의 app-server. 실제 계정이나 모델 서버에 연결하지 않는다.
const fs=require('node:fs');
const {spawn}=require('node:child_process'),readline=require('node:readline'),path=require('node:path');
const widePrompt = '최근 변경한 화면을 작은 창에서 다시 열고 줄바꿈, 읽던 위치와 하단 입력 영역을 확인해 주세요. '.repeat(8).trim();
const child=spawn(process.execPath,[path.join(__dirname,'backend-fake-codex.cjs')],{stdio:['pipe','pipe','inherit']}),threads=new Set();child.stdout.pipe(process.stdout);const write=value=>process.stdout.write(JSON.stringify(value)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line),{id,method,params={}}=request;
 if(method==='config/read'){write({id,result:{config:{}}});return;}
 if(method==='thread/start'&&params.ephemeral&&params.permissions){const threadId='followup-analysis';threads.add(threadId);write({id,result:{thread:{id:threadId},activePermissionProfile:{id:params.permissions}}});return;}
 if(method==='turn/start'&&threads.has(params.threadId)){
  const trace=process.env.FLOWRIUM_TEST_FOLLOWUP_TRACE;
  if(trace)fs.appendFileSync(trace,'request\n');
  const prompt=params.input?.map(row=>row.text || '').join(' ') || '';
  const slow=prompt.includes('기기별 분류표 검증');
  const offline=prompt.includes('응답 중단 검증');
  const staged=prompt.includes('응답 순서 검증');
  const timingTrace=process.env.FLOWRIUM_TEST_FOLLOWUP_LATENCY;
  if(slow && timingTrace)fs.appendFileSync(timingTrace,'시작\n');
  const turnId='followup-turn';
  write({id,result:{turn:{id:turnId,status:'inProgress'}}});
  setTimeout(()=>{
   const send=(method,params_)=>write({method,params:{threadId:params.threadId,...params_}});
   if(offline){
    send('turn/completed',{turn:{id:turnId,status:'failed',error:{message:'합성 시험 모델 응답 중단'}}});
    return;
   }
   const suggestion={
    title:'검색 회귀 검사',
    prompt:prompt.includes('입력창 높이 검증') ? widePrompt : '한글 검색어와 빈 검색어의 회귀 검사를 작성하고 결과를 알려 주세요.',
    reason:'대화에서 확인한 검색 기능의 입력 경계를 검증합니다.',
   };
   send('item/completed',{turnId,item:{id:'followup-answer',type:'agentMessage',text:JSON.stringify({suggestions:[suggestion]})}});
   send('turn/completed',{turn:{id:turnId,status:'completed'}});
   if(slow && timingTrace)fs.appendFileSync(timingTrace,'완료\n');
  },slow ? 12000 : staged ? 3500 : 150);
  return;
 }
 child.stdin.write(line+'\n');
}).on('close',()=>child.stdin.end());child.on('exit',code=>{process.exitCode=code||0});process.on('SIGTERM',()=>{child.kill();process.exit()});
