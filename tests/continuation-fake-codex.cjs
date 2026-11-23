// 합성 대화의 일반 전송과 추천용 모델 호출을 구별해 기록한다.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const {spawn} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const child = spawn(process.execPath,[path.join(__dirname,'backend-fake-codex.cjs')], {stdio:['pipe','pipe','inherit']});
const analysis = new Set();
const write = value => process.stdout.write(JSON.stringify(value)+'\n');
readline.createInterface({input:process.stdin}).on('line',line => {
  const {id,method,params={}} = JSON.parse(line);
  if (method === 'config/read') {
    write({id,result:{config:{}}});
    return;
  }
  if (method === 'thread/start' && params.ephemeral) analysis.add(id);
  const analyzing=analysis.has(params.threadId);
  if (method === 'turn/start' && process.env.FLOWRIUM_TEST_FOLLOWUP_TRACE) {
    fs.appendFileSync(process.env.FLOWRIUM_TEST_FOLLOWUP_TRACE,analyzing?'분석\n':'전송\n');
  }
  if (method === 'turn/start' && analyzing && params.outputSchema?.properties?.suggestions && process.env.FLOWRIUM_TEST_FOLLOWUP_MODEL) {
    const turnId=randomUUID(),threadId=params.threadId;
    const result=JSON.parse(process.env.FLOWRIUM_TEST_FOLLOWUP_MODEL);
    const evidence=JSON.stringify(params.additionalContext||{});
    const item={id:randomUUID(),type:'agentMessage',phase:'final_answer',text:JSON.stringify({
      suggestions:evidence.includes(result.evidence)?[result]:[],
    })};
    write({id,result:{turn:{id:turnId,status:'inProgress'}}});
    write({method:'item/completed',params:{threadId,turnId,item}});
    write({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}});
    return;
  }
  child.stdin.write(line+'\n');
}).on('close',()=>child.stdin.end());
readline.createInterface({input:child.stdout}).on('line', line => {
  const {id,result} = JSON.parse(line);
  if (analysis.delete(id) && result?.thread) analysis.add(result.thread.id);
  process.stdout.write(line+'\n');
});
child.on('exit',code=>{process.exitCode=code || 0;});
process.on('SIGTERM',()=>{child.kill();process.exit();});
