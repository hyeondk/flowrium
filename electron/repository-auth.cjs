const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
async function accounts(env,cwd,run=exec) {
  try {
    const {stdout}=await run('gh',['auth','status','--hostname','github.com','--json','hosts'],{cwd,env,timeout:10000,windowsHide:true,maxBuffer:1024*1024});
    const data=JSON.parse(stdout),rows=data.hosts?.['github.com']||[];
    return rows.filter(r=>r.state==='success'||r.login).map(r=>({login:r.login,active:!!r.active,state:r.state||'success',protocol:r.gitProtocol||''}));
  } catch {return [];}
}
async function accountEnvironment(account,env,cwd,run=exec) {
  if(!account)return env;
  if(!/^[a-zA-Z0-9-]{1,39}$/.test(account))throw new Error('사용할 GitHub 계정을 확인해 주세요.');
  try {
    const {stdout}=await run('gh',['auth','token','--hostname','github.com','--user',account],{cwd,env:{...env,GH_TOKEN:undefined,GITHUB_TOKEN:undefined},timeout:10000,windowsHide:true,maxBuffer:65536});
    const token=stdout.trim();if(!token||token.length>2000||/\s/.test(token))throw Error();
    return {...env,GH_TOKEN:token,GITHUB_TOKEN:undefined};
  } catch {throw new Error('선택한 GitHub 계정으로 로그인한 뒤 다시 시도해 주세요.');}
}
module.exports={accounts,accountEnvironment};
