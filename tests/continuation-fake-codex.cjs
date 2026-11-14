// 화면 회귀 전용 모의 app-server. 실제 계정이나 모델 서버에 연결하지 않는다.
const {spawn}=require('node:child_process'),readline=require('node:readline'),path=require('node:path');
const child=spawn(process.execPath,[path.join(__dirname,'backend-fake-codex.cjs')],{stdio:['pipe','pipe','inherit']}),threads=new Set();child.stdout.pipe(process.stdout);const write=value=>process.stdout.write(JSON.stringify(value)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line),{id,method,params={}}=request;
 if(method==='config/read'){write({id,result:{config:{}}});return;}
 if(method==='thread/start'&&params.ephemeral&&params.permissions){const threadId='followup-analysis';threads.add(threadId);write({id,result:{thread:{id:threadId},activePermissionProfile:{id:params.permissions}}});return;}
 if(method==='turn/start'&&threads.has(params.threadId)){write({id,result:{turn:{id:'followup-turn',status:'inProgress'}}});setTimeout(()=>{write({method:'item/completed',params:{threadId:params.threadId,turnId:'followup-turn',item:{id:'followup-answer',type:'agentMessage',text:JSON.stringify({suggestions:[{title:'검색 회귀 검사',prompt:'한글 검색어와 빈 검색어의 회귀 검사를 작성하고 결과를 알려 주세요.',reason:'대화에서 확인한 검색 기능의 입력 경계를 검증합니다.'}]})}}});write({method:'turn/completed',params:{threadId:params.threadId,turn:{id:'followup-turn',status:'completed'}}});},150);return;}
 child.stdin.write(line+'\n');
}).on('close',()=>child.stdin.end());child.on('exit',code=>{process.exitCode=code||0});process.on('SIGTERM',()=>{child.kill();process.exit()});
