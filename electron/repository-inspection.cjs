const {createHash} = require('node:crypto');

const actions = new Set(['repoLocal','repoConnect','repoActivity','repoPull','repoIssue','repoOpen']);
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/[a-z0-9_.-]{1,100}$/i;
function slug(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!slugPattern.test(v) || v.endsWith('/.') || v.endsWith('/..'))
    throw new Error('GitHub 소유자와 저장소 이름을 소유자/저장소 형식으로 입력해 주세요.');
  return v;
}
function originName(value) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(value);
  if (!match) return '';
  try { return slug(match[1]); } catch { return ''; }
}
async function inspectRepository(input, run, openUrl = url => require('electron').shell.openExternal(url)) {
  const git = (...args) => run('git',args);
  const gh = async (...args) => JSON.parse(await run('gh',args));
  const remotes = (await git('remote')).split(/\r?\n/);
  const hasOrigin = remotes.includes('origin');
  const urls = hasOrigin ? (await git('remote','get-url','--all','origin')).trim().split(/\r?\n/) : [];
  const pushUrls = hasOrigin ? (await git('remote','get-url','--push','--all','origin')).trim().split(/\r?\n/) : [];
  const key = createHash('sha256').update(JSON.stringify([urls,pushUrls])).digest('hex');
  const repository = originName(urls[0] || '');
  if (input.action === 'repoConnect') {
    if (key !== input.connectionKey) throw new Error('원격 연결이 변경됐습니다. 현재 연결을 다시 확인해 주세요.');
    const target = 'https://github.com/'+slug(input.repository)+'.git';
    if (hasOrigin && (urls.length!==1 || pushUrls.length!==1 || urls[0]!==pushUrls[0]))
      throw new Error('별도로 지정된 가져오기 및 푸시 주소가 있습니다. Git에서 연결 설정을 확인해 주세요.');
    if (!hasOrigin) await git('remote','add','origin',target);
    else if (urls[0]!==target) {
      const escaped = urls[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      await git('remote','set-url','origin',target,'^'+escaped+'$');
    }
    return '프로젝트의 원격 저장소를 연결했습니다.';
  }
  if (input.action === 'repoLocal') {
    const branch=(await git('branch','--show-current')).trim();
    const head=(await git('rev-parse','--verify','HEAD').catch(()=> '')).trim();
    const commits=[];
    if (head) {
      const values=(await git('log','-z','-12','--format=%h%x00%an%x00%aI%x00%s')).split('\0');
      for(let i=0;i+3<values.length;i+=4) commits.push({hash:values[i],author:values[i+1],date:values[i+2],subject:values[i+3]});
    }
    const upstream = branch ? (await git('for-each-ref','--format=%(upstream:short)','refs/heads/'+branch)).trim() : '';
    const counts = upstream ? await git('rev-list','--left-right','--count','HEAD...@{upstream}').catch(()=> '') : '';
    const [ahead,behind] = counts.trim() ? counts.trim().split(/\s+/).map(Number) : [null,null];
    return {branch,head,upstream,ahead,behind,commits,repository,hasOrigin,connectionKey:key};
  }
  if (!repository) throw new Error('GitHub 저장소를 origin으로 연결한 뒤 조회해 주세요.');
  const endpoint='repos/'+repository;
  if (input.action === 'repoOpen') {
    let route='';
    if (input.kind !== 'repo') {
      if (!Number.isSafeInteger(input.number) || input.number<1) throw new Error('항목 번호를 확인해 주세요.');
      const prefix = {pull:'/pull/',issue:'/issues/',run:'/actions/runs/'}[input.kind];
      if(typeof prefix!=='string') throw new Error('열 항목을 확인해 주세요.');
      route = prefix+input.number;
    }
    await openUrl('https://github.com/'+repository+route);
    return '기본 브라우저에서 열었습니다.';
  }
  if (input.action==='repoPull' || input.action==='repoIssue') {
    if (!Number.isSafeInteger(input.number)||input.number<1) throw new Error('항목 번호를 확인해 주세요.');
    const pull = input.action==='repoPull';
    const data=await gh(pull?'pr':'issue','view',String(input.number),'--repo',repository,'--json',
      pull?'number,title,state,body,files,reviewDecision,statusCheckRollup,headRefName,baseRefName':
        'number,title,state,body,labels,assignees');
    return {number:data.number,title:data.title,state:data.state,body:data.body?.slice(0,20000)||'',
      files:(data.files||[]).map(f=>({name:f.path,added:f.additions,deleted:f.deletions})),
      checks:(data.statusCheckRollup||[]).map(c=>({name:c.name||c.context,state:c.conclusion||c.status||c.state})),
      review:data.reviewDecision||'',labels:(data.labels||[]).map(l=>l.name),assignees:(data.assignees||[]).map(a=>a.login)};
  }
  if(input.action!=='repoActivity') throw new Error('저장소 조회 항목을 확인해 주세요.');
  async function deployments(){
    const entries=await gh('api',endpoint+'/deployments?per_page=5');
    return Promise.all(entries.map(async d=>{
      let state='상태 없음';
      try { const statuses=await gh('api',endpoint+'/deployments/'+d.id+'/statuses?per_page=1'); state=statuses[0]?.state||state; }
      catch {state='상태 조회 실패';}
      return {number:d.id,title:d.environment,state,branch:d.ref};
    }));
  }
  const definitions={
    pulls:()=>gh('pr','list','--repo',repository,'--state','open','--limit','30','--json','number,title,state,reviewDecision,isDraft'),
    merged:()=>gh('pr','list','--repo',repository,'--state','merged','--limit','8','--json','number,title,state'),
    issues:()=>gh('issue','list','--repo',repository,'--state','open','--limit','30','--json','number,title,state'),
    runs:async()=>(await gh('run','list','--repo',repository,'--limit','10','--json','databaseId,displayTitle,name,status,conclusion,headBranch'))
      .map(r=>({number:r.databaseId,title:r.displayTitle||r.name,state:r.conclusion||r.status,branch:r.headBranch})),
    deployments,
  };
  const entries=await Promise.all(Object.entries(definitions).map(async ([section,load])=>{
    try {return [section,{rows:await load(),error:''}];}
    catch(error){return [section,{rows:[],error:error.message}];}
  }));
  return {repository,...Object.fromEntries(entries)};
}
module.exports={inspectionActions:actions, inspectRepository};
