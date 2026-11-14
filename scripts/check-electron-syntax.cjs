const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function collect(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{const file=path.join(directory,entry.name);return entry.isDirectory()?collect(file):entry.isFile()&&entry.name.endsWith('.cjs')?[file]:[]})}
const files=collect(path.join(root,'electron'));let failed=0;

for(const file of files){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8',windowsHide:true});if(result.status!==0){failed++;process.stderr.write(path.relative(root,file)+'\n'+(result.stderr||result.error?.message||'구문 확인 실패')+'\n')}}
if(failed){console.error('앱 실행 코드 구문 오류 '+failed+'개');process.exitCode=1}else console.log('앱 실행 코드 '+files.length+'개 구문 확인 통과');
