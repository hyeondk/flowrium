// 합성 대화의 일반 전송과 추천용 모델 호출을 구별해 기록한다.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const {spawn} = require('node:child_process');
const child = spawn(process.execPath,[path.join(__dirname,'backend-fake-codex.cjs')], {stdio:['pipe','pipe','inherit']});
const analysis = new Set();
readline.createInterface({input:process.stdin}).on('line',line => {
  const {id,method,params={}} = JSON.parse(line);
  if (method === 'config/read') {
    process.stdout.write(JSON.stringify({id,result:{config:{}}})+'\n');
    return;
  }
  if (method === 'thread/start' && params.ephemeral) analysis.add(id);
  if (method === 'turn/start' && process.env.FLOWRIUM_TEST_FOLLOWUP_TRACE) {
    fs.appendFileSync(process.env.FLOWRIUM_TEST_FOLLOWUP_TRACE,analysis.has(params.threadId)?'분석\n':'전송\n');
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
