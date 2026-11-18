const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
test('터미널 설치기는 운영체제 보안 정책을 해제하거나 원격 코드를 바로 실행하지 않는다',async()=>{
 const root=path.resolve(__dirname,'..'),mac=await fs.readFile(path.join(root,'install.sh'),'utf8'),windows=await fs.readFile(path.join(root,'install.ps1'));
 for(const source of [mac,windows.toString('utf8')]){assert.doesNotMatch(source,/\b(?:xattr|spctl|Unblock-File|Set-MpPreference|Set-ExecutionPolicy|Invoke-Expression)\b/i);assert.doesNotMatch(source,/ExecutionPolicy\s+Bypass|curl[^\n]*\|\s*(?:ba)?sh|\|\s*iex\b/i);}
 assert.deepEqual([...windows.subarray(0,3)],[0xef,0xbb,0xbf]);
});

test('맥 설치기는 대상 앱의 작업을 차단하고 독립 휴대폰 중계 쌍만 허용한다',{skip:process.platform==='win32'},async()=>{
 const installer=await fs.readFile(path.resolve(__dirname,'..','install.sh'),'utf8');
 const check=installer.slice(installer.indexOf('target_is_idle(){'),installer.indexOf('assert_stopped(){'));
 const target='/Applications/내 작업/Flowrium.app';
 const runtime=target+'/Contents/Resources/runtime/bin';
 const owner=501;
 const node='81 1 '+owner+' '+runtime+'/node',tunnel='82 81 '+owner+' '+runtime+'/cloudflared';
 const script=await fs.readFile(path.resolve(__dirname,'..','electron','mobile-bridge.cjs'),'utf8');
 const broker=runtime+'/node --input-type=commonjs -e '+script+'\nstartProcess();';
 const tunnelCommand=runtime+'/cloudflared tunnel --url http://127.0.0.1:51000 --no-autoupdate';
 const result=(rows,brokerArgs=broker,tunnelArgs=tunnelCommand)=>{
  const cmd=check+'\nprocess_command(){ case "$1" in 81) printf "%s" "$BROKER_ARGS";; 82) printf "%s" "$TUNNEL_ARGS";; *) return 1;; esac; }\ntarget_is_idle "$1" "$2"';
  return require('node:child_process').spawnSync('/bin/bash',['-c',cmd,'test',target,String(owner)],{
   input:rows.join('\n')+'\n',env:{BROKER_ARGS:brokerArgs,TUNNEL_ARGS:tunnelArgs}
  }).status;
 };
 assert.equal(result([node,tunnel]),0);
 assert.equal(result(['77 1 501 /다른 위치/Flowrium.app/Contents/MacOS/Flowrium']),0);
 for(const rows of [[node],[tunnel],[node,tunnel.replace('82 81 ','82 1 ')],
  [node,tunnel,'99 81 501 '+runtime+'/worker'],['99 1 501 '+target+'/Contents/MacOS/Flowrium'],
  [node.replace('81 1 501','81 1 502'),tunnel]])assert.equal(result(rows),1);
 assert.equal(result([node,tunnel],runtime+'/node 작업.js'),1);
 assert.equal(result([node,tunnel],broker,tunnelCommand.replace('127.0.0.1','localhost')),1);
});
