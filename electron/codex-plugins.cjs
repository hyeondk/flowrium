const {execFile} = require('node:child_process');
const runFile = require('node:util').promisify(execFile);

const officialDirectory = 'https://chatgpt.com/apps';
const pluginId = /^[a-z0-9][a-z0-9_.-]*@[a-z0-9][a-z0-9_.-]*$/i;
const appId = /^[a-z0-9_.~:@+-]+$/i;
const maxReferences = 8;
const key = ({kind,id}) => kind+':'+id;
const phrase = (value,limit) => typeof value==='string' ? value.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,limit) : '';
const items = (value,max=800) => Array.isArray(value) ? value.slice(0,max) : [];
const unsupported = error => error?.rpcCode===-32601 || /(?:unsupported|unknown) method|method not found|experimentalApi/i.test(error?.rpcMessage||'');
const slug = value => value.toLowerCase().replace(/[^a-z0-9]/g,'');
const label = value => ({
  github:'GitHub',gmail:'Gmail',pdf:'PDF',notion:'Notion',
  'google-drive':'Google Drive','google-calendar':'Google Calendar','google-contacts':'Google Contacts',
})[value] || value.split('-').map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join(' ');

function checkedReferences(value) {
  if (value===undefined) return [];
  if (!Array.isArray(value) || value.length>maxReferences) throw Error('한 요청에 연결 도구를 최대 8개까지 사용할 수 있습니다.');
  const unique = new Map();
  for (const entry of value) {
    const pattern=entry?.kind==='app'?appId:entry?.kind==='plugin'?pluginId:null;
    if (!pattern || typeof entry.id!=='string' || entry.id.length>240 ||
        !pattern.test(entry.id) || !phrase(entry.name,100)) throw Error('연결 도구를 목록에서 다시 선택해 주세요.');
    const ref = {kind:entry.kind,id:entry.id,name:phrase(entry.name,100)};
    unique.set(key(ref),ref);
  }
  return [...unique.values()];
}

function mentionInputs(references) {
  return checkedReferences(references).map(({kind,id,name})=>({type:'mention',name,path:kind+'://'+id}));
}

function allowedAppUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin === 'https://chatgpt.com' && !url.username && !url.password && url.pathname.startsWith('/apps/')) return url.href;
  } catch {}
  return null;
}

function listing(plugin) {
  const id=plugin?.pluginId, market=plugin?.marketplaceName;
  if (typeof id!=='string' || id.length>240 || !pluginId.test(id) ||
      typeof plugin.name!=='string' || id !== plugin.name+'@'+market) return null;
  const source=plugin.source?.source;
  const remote=source==='remote' && market==='openai-curated-remote';
  const install=!plugin.installed && plugin.installPolicy==='AVAILABLE';
  return {kind:'plugin',id,name:label(plugin.name),market,source,description:'',installed:plugin.installed===true,
    enabled:plugin.enabled===true,available:plugin.installPolicy!=='NOT_AVAILABLE',install:install ? remote?'direct':'official' : null};
}

function pluginRows(payload) {
  if (!Array.isArray(payload?.installed) || !Array.isArray(payload.available)) throw Error('Codex 플러그인 목록 형식을 확인하지 못했습니다.');
  return [...items(payload.installed,3000),...items(payload.available,30000)].map(listing).filter(Boolean);
}

function appRows(payload) {
  return items(payload?.apps).filter(row=>typeof row?.id==='string'&&row.id.length<=240&&appId.test(row.id)).map(row=>({
    kind:'app',id:row.id,name:phrase(row.runtimeName,100)||row.id,description:'',installed:true,
    enabled:row.enabled===true&&row.callable===true,available:row.enabled===true,install:null,
  }));
}

function directoryRows(payload) {
  return items(payload?.data,100).filter(row=>typeof row?.id==='string'&&row.id.length<=240&&appId.test(row.id)).map(row=>({
    kind:'app',id:row.id,name:phrase(row.name,100)||row.id,description:phrase(row.description,300),
    installed:row.isAccessible===true,enabled:false,available:row.isEnabled===true,
    install:row.isAccessible===true?null:'official',url:allowedAppUrl(row.installUrl),
    pluginNames:items(row.pluginDisplayNames,25).filter(name=>typeof name==='string'),
  }));
}

function publicRow({source,url,pluginNames,...row}) { return row; }
function identity(ref) { return {kind:ref.kind,id:ref.id,name:ref.name}; }

async function cliJSON(descriptor,directory,args,timeout,signal) {
  if(!descriptor?.command)throw Error('Codex 플러그인 실행 파일을 찾지 못했습니다.');
  const env={...process.env};
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  delete env.OPENAI_BASE_URL;
  if(descriptor.node)env.ELECTRON_RUN_AS_NODE='1';
  const {stdout}=await runFile(descriptor.command,[...descriptor.prefix,'plugin',...args],{
    cwd:directory,env,signal,windowsHide:true,shell:false,timeout,maxBuffer:32*1024*1024,
  });
  return JSON.parse(stdout);
}

function registerCodexPlugins(register,{controller,getContext,openExternal,directory,execute=cliJSON,now=Date.now}) {
  let cache, flight, catalog, catalogFlight, changing=false, activeContext;
  let accountAbort=new AbortController();
  const records=new Map();
  function stamp() {
    const context=getContext();
    if(!context) throw Error('계정이나 잠금 상태를 확인해 주세요.');
    if(activeContext!==context){invalidate();activeContext=context;}
    return context;
  }
  function invalidate() {
    accountAbort.abort();
    accountAbort=new AbortController();
    records.clear();
    cache=catalog=flight=catalogFlight=undefined;
  }
  function guard(context) {
    if (getContext()!==context || activeContext!==context) throw Error('연결 계정이나 잠금 상태가 바뀌었습니다.');
  }
  async function ready(context) {
    const {client,store}=controller;
    await client.start(store.state.settings.codexPath);
    const account=await client.request('account/read',{refreshToken:false},6000);
    guard(context);
    if (account.account?.type!=='chatgpt') throw Error('ChatGPT 계정으로 로그인한 뒤 플러그인을 사용해 주세요.');
    if (await controller.accountObserved?.(account.account)) throw Error('연결 계정이 바뀌었습니다. 다시 열어 주세요.');
    guard(context);
    return client;
  }
  function remember(context, rows) {
    guard(context);
    for (const row of rows) records.set(key(row),{row,at:now()});
    while(records.size>1800) records.delete(records.keys().next().value);
  }
  function installed(context, fresh=false) {
    guard(context);
    if (!fresh && cache?.context===context && now()-cache.at<30000 && cache.process===controller.client.proc) return Promise.resolve(cache.value);
    if (flight?.context===context) return flight.promise;
    const query={context};
    query.promise=(async()=>{
      const client=await ready(context), signal=accountAbort.signal;
      const [apps,plugins]=await Promise.allSettled([
        client.request('app/installed',fresh?{forceRefresh:true}:{},7000),
        execute(client.descriptor,directory,['list','--json'],15000,signal).then(pluginRows),
      ]);
      guard(context);
      const rows=[...(apps.status==='fulfilled'?appRows(apps.value):[]),...(plugins.status==='fulfilled'?plugins.value:[])];
      const value={rows,unsupported:apps.status==='rejected'&&plugins.status==='rejected'&&unsupported(apps.reason),
        partial:apps.status==='rejected'||plugins.status==='rejected'};
      remember(context,rows);
      cache={context,value,at:now(),process:client.proc};
      return value;
    })().finally(()=>{if(flight===query)flight=undefined;});
    flight=query;
    return query.promise;
  }
  function available(context, fresh=false) {
    guard(context);
    if (!fresh && catalog?.context===context && now()-catalog.at<60000 && catalog.process===controller.client.proc) return Promise.resolve(catalog.value);
    if (catalogFlight?.context===context) return catalogFlight.promise;
    const query={context};
    query.promise=(async()=>{
      const client=await ready(context), signal=accountAbort.signal;
      const [plugins,apps]=await Promise.allSettled([
        execute(client.descriptor,directory,['list','--available','--json'],30000,signal).then(pluginRows),
        client.request('app/list', {limit:100,...(fresh&&{forceRefetch:true})},8500),
      ]);
      guard(context);
      const rows=[...(plugins.status==='fulfilled'?plugins.value:[]),...(apps.status==='fulfilled'?directoryRows(apps.value):[])];
      const value={rows,partial:plugins.status==='rejected'||apps.status==='rejected'};
      catalog={context,value,at:now(),process:client.proc};
      return value;
    })().finally(()=>{if(catalogFlight===query)catalogFlight=undefined;});
    catalogFlight=query;
    return query.promise;
  }
  async function list(input={}) {
    if(!input || !['suggestions','catalog','available'].includes(input.view) ||
       (input.search!==undefined&&(typeof input.search!=='string'||input.search.length>120)))
      throw Error('플러그인 목록 검색을 확인해 주세요.');
    const context=stamp(), fresh=input.refresh===true;
    const snapshot=await installed(context,fresh && input.view!=='available');
    guard(context);
    if(input.view==='suggestions') return {...snapshot,rows:snapshot.rows.filter(row=>row.installed&&row.enabled).map(publicRow)};
    if(input.view==='catalog') return {...snapshot,rows:snapshot.rows.map(publicRow)};
    const directory=await available(context,fresh);
    guard(context);
    const metadataById=new Map(directory.rows.map(row=>[key(row),row]));
    const combined=new Map([...directory.rows,...snapshot.rows.map(row=>{
      const metadata=metadataById.get(key(row));
      return {...metadata,...row,description:metadata?.description||row.description};
    })].map(row=>[key(row),row]));
    const term=phrase(input.search,120).toLowerCase();
    const rows=[...combined.values()].filter(row=>term?[row.name,row.id,row.description].some(value=>value.toLowerCase().includes(term)):!row.installed);
    if(term)rows.sort((a,b)=>Number(b.name.toLowerCase().startsWith(term))-Number(a.name.toLowerCase().startsWith(term)));
    const shown=rows.slice(0,80);
    remember(context,shown);
    return {rows:shown.map(publicRow),unsupported:snapshot.unsupported&&!directory.rows.length,
      partial:snapshot.partial||directory.partial};
  }
  async function selected(input,context) {
    const entry=records.get(key(input));
    if (entry && now()-entry.at<300000) return entry.row;
    await installed(context);
    guard(context);
    const fresh=records.get(key(input));
    if(fresh && now()-fresh.at<300000) return fresh.row;
    throw Error('플러그인 목록을 다시 조회한 뒤 선택해 주세요.');
  }
  function serviceApps(row,snapshot,availableRows) {
    const known=new Map([...availableRows,...snapshot].filter(candidate=>candidate.kind==='app').map(candidate=>[candidate.id,{
      ...availableRows.find(metadata=>metadata.kind==='app'&&metadata.id===candidate.id),...candidate,
    }]));
    if(row.kind==='app')return known.has(row.id)?[known.get(row.id)]:[row];
    const name=slug(row.name);
    return [...known.values()].filter(app=>slug(app.name)===name||app.pluginNames?.some(value=>slug(value)===name));
  }
  async function appLinks(client,row,context) {
    const snapshot=await installed(context);
    if(row.kind==='app') {
      const result=await client.request('app/read',{appIds:[row.id]},5000).catch(()=>null);
      guard(context);
      return [{...row,url:allowedAppUrl(result?.apps?.find(candidate=>candidate.id===row.id)?.installUrl)||row.url}];
    }
    const known=serviceApps(row,snapshot.rows,catalog?.context===context?catalog.value.rows:[]);
    if(known.length)return known;
    const fetched=await available(context);
    return serviceApps(row,snapshot.rows,fetched.rows);
  }
  async function manage(input) {
    if(!input || typeof input!=='object' || !['details','install','connect','directory'].includes(input.action))
      throw Error('플러그인 작업을 확인해 주세요.');
    const context=stamp();
    if(input.action==='directory') {
      await openExternal(officialDirectory);
      guard(context);
      return {};
    }
    const [ref]=checkedReferences([{kind:input.kind,id:input.id,name:'플러그인'}]);
    const row=await selected(ref,context), client=await ready(context);
    if(input.action==='install') {
      if(input.confirmed!==true || row.install!=='direct' || changing) throw Error('설치 내용을 확인한 뒤 설치할 수 있는 플러그인을 선택해 주세요.');
      changing=true;
      const signal=accountAbort.signal;
      try {
        const latest=await execute(client.descriptor,directory,['list','--available','--json','--marketplace',row.market],30000,signal)
          .then(pluginRows).catch(()=>[]);
        guard(context);
        const current=latest.find(value=>value.id===row.id);
        if(current?.installed)return {installed:true};
        if(current?.install!=='direct')throw Error('현재 이 플러그인을 앱에서 설치할 수 없습니다. 공식 화면의 설치 상태를 확인해 주세요.');
        const result=await execute(client.descriptor,directory,['add',current.id,'--json'],35000,signal).catch(()=>null);
        guard(context);
        cache=catalog=undefined;
        records.delete(key(row));
        if(result?.pluginId!==row.id)throw Error('설치 결과를 확인하지 못했습니다. 다시 설치하기 전에 목록을 새로고침해 주세요.');
        return {installed:true,authRequired:result.authPolicy==='ON_INSTALL'};
      } finally { changing=false; }
    }
    const apps=await appLinks(client,row,context);
    guard(context);
    if(input.action==='details') return {apps:apps.map(app=>({id:app.id,name:app.name,connected:app.enabled}))};
    const app=apps.find(value=>value.id===input.appId);
    if(!app) throw Error('연결할 서비스를 선택해 주세요.');
    await openExternal(app.url||officialDirectory);
    guard(context);
    return {opened:true};
  }
  async function resolve(value) {
    const refs=checkedReferences(value);
    if(!refs.length) return refs;
    const context=stamp(), snapshot=await installed(context);
    guard(context);
    const available=new Map(snapshot.rows.filter(row=>row.installed&&row.enabled).map(row=>[key(row),row]));
    return refs.map(ref=>{
      const matched=available.get(key(ref));
      if(!matched) throw Error('연결이 끊겼거나 현재 계정에서 사용할 수 없는 도구입니다. @ 목록에서 다시 선택해 주세요.');
      return identity(matched);
    });
  }
  register('readCodexPlugins',list);
  register('manageCodexPlugin',manage);
  return {resolve,invalidate};
}

module.exports={checkedReferences,mentionInputs,registerCodexPlugins,allowedAppUrl,cliJSON};
