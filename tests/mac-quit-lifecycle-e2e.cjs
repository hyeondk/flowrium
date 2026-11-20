const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util'),{randomUUID,createHash}=require('node:crypto');
const run=promisify(execFile),{Store}=require('../electron/store.cjs'),root=path.resolve(__dirname,'..'),qa=path.join(root,'.flowrium-tmp','qa-261115_03');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const query=String.raw`function run(argv){ObjC.import('AppKit');const apps=$.NSWorkspace.sharedWorkspace.runningApplications,out=[];for(let i=0;i<Number(apps.count);i++){const app=apps.objectAtIndex(i);let location;try{location=ObjC.unwrap(app.bundleURL.path)}catch{continue}if(location===argv[0])out.push({pid:Number(app.processIdentifier),terminated:Boolean(app.terminated)});}return JSON.stringify(out);}`;
const quit=String.raw`function run(argv){ObjC.import('AppKit');const app=$.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[1]));if(!app||ObjC.unwrap(app.bundleURL.path)!==argv[0])throw Error('시험 앱 식별이 바뀌었습니다.');return JSON.stringify({requested:Boolean(app.terminate)});}`;
(async()=>{
 if(process.platform!=='darwin'){console.log('맥 LaunchServices 종료 검사는 Mac에서 실행합니다.');return;}
 await fs.mkdir(qa,{recursive:true});const temp=await fs.mkdtemp(path.join(qa,'mac-quit-')),profile=path.join(temp,'profile'),codex=path.join(temp,'codex'),log=path.join(temp,'lifecycle.log'),out=path.join(temp,'stdout.log');
 const archiveAt=process.argv.indexOf('--archive'),archive=archiveAt<0?null:process.argv[archiveAt+1],expectedResident=process.argv.includes('--expect-resident'),patched=process.argv.includes('--patch-main'),sequential=process.argv.includes('--sequential');let appPath=path.dirname(path.dirname(path.dirname(require('electron')))),pid,remaining=false;
 const result={packaged:!!archive,inspector:false,syntheticProfile:true,unixSignalsSent:0,forcedTermination:false,expectedResident,patched,sequential,runs:[]};
 async function applications(){return JSON.parse((await run('/usr/bin/osascript',['-l','JavaScript','-e',query,appPath],{timeout:15000})).stdout.trim());}
 async function live(){if(!pid)return false;try{const value=(await run('/bin/ps',['-p',String(pid),'-o','command='],{timeout:5000})).stdout.trim();return !!value;}catch(error){if(error.code===1)return false;throw error;}}
 async function stages(){let text='';try{text=await fs.readFile(log,'utf8')}catch(error){if(error.code!=='ENOENT')throw error;}return text.split('\n').filter(row=>row.startsWith('[FlowriumLifecycle] ')).map(row=>JSON.parse(row.slice('[FlowriumLifecycle] '.length)));}
 async function requestQuit(){const current=(await run('/bin/ps',['-p',String(pid),'-o','command='],{timeout:5000})).stdout;assert(current.includes(profile),'합성 프로필 인수가 있는 시험 앱만 종료한다');assert(!/--inspect|--remote-debugging/.test(current),'디버거 없는 실행을 검사한다');return JSON.parse((await run('/usr/bin/osascript',['-l','JavaScript','-e',quit,appPath,String(pid)],{timeout:15000})).stdout);}
 try{
  if(archive){await run('/usr/bin/ditto',['-x','-k',path.resolve(archive),temp],{timeout:120000});appPath=path.join(temp,'Flowrium.app');}
  if(patched){
   assert(archive,'패키지 사본에서만 후보 코드를 비교한다');const asar=require('@electron/asar'),pickle=require('chromium-pickle-js'),archiveFile=path.join(appPath,'Contents','Resources','app.asar'),old=await fs.readFile(archiveFile),header=asar.getRawHeader(archiveFile),data=old.subarray(8+header.headerSize),main=await fs.readFile(path.join(root,'electron','main.cjs')),entry=header.header.files.electron.files['main.cjs'];
   assert(!entry.unpacked&&!entry.link);entry.size=main.length;entry.offset=String(data.length);const blockSize=entry.integrity?.blockSize||4194304,hash=bytes=>createHash('sha256').update(bytes).digest('hex'),blocks=[];for(let i=0;i<main.length;i+=blockSize)blocks.push(hash(main.subarray(i,i+blockSize)));entry.integrity={algorithm:'SHA256',hash:hash(main),blockSize,blocks};
   const headerString=JSON.stringify(header.header),body=pickle.createEmpty();body.writeString(headerString);const headerBuffer=body.toBuffer(),size=pickle.createEmpty();size.writeUInt32(headerBuffer.length);await fs.writeFile(archiveFile,Buffer.concat([size.toBuffer(),headerBuffer,data,main]));asar.uncache(archiveFile);assert.deepEqual(asar.extractFile(archiveFile,'electron/main.cjs'),main);
   const plistPath=path.join(appPath,'Contents','Info.plist'),plist=JSON.parse((await run('/usr/bin/plutil',['-convert','json','-o','-',plistPath])).stdout);plist.ElectronAsarIntegrity={...plist.ElectronAsarIntegrity,'Resources/app.asar':{algorithm:'SHA256',hash:hash(Buffer.from(headerString))}};await fs.writeFile(plistPath,JSON.stringify(plist));await run('/usr/bin/plutil',['-convert','xml1',plistPath]);await run('/usr/bin/codesign',['--force','--deep','--sign','-','--timestamp=none',appPath],{timeout:120000});await run('/usr/bin/codesign',['--verify','--deep','--strict',appPath],{timeout:30000});result.patchedMainOnly=true;result.candidateSignatureIntegrity=true;
  }
  const store=new Store(profile);await store.load();await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});await fs.mkdir(codex);const projectPath=path.join(temp,'project');await fs.mkdir(projectPath);const project=await store.addProject(projectPath),session=await store.createSession(project.id,{title:'정상 종료 저장 검사'});store.session(session.id).messages.push({id:randomUUID(),role:'user',text:'정상 종료 후에도 보존할 합성 문장',createdAt:new Date().toISOString()});await store.save();
  for(let iteration=0;iteration<(sequential?2:1);iteration++){
  pid=undefined;remaining=false;await fs.writeFile(log,'');
  await run('/usr/bin/open',['-n','-a',appPath,'--stderr',log,'--stdout',out,'--env','FLOWRIUM_LIFECYCLE_DIAGNOSTICS=1','--env','FLOWRIUM_USER_DATA='+profile,'--env','CODEX_HOME='+codex,'--args',...(archive?[]:[root]),'--user-data-dir='+profile],{timeout:15000});
  const deadline=Date.now()+30000;let before=[];while(Date.now()<deadline){before=await stages();if(before.some(row=>row.phase==='bootstrap-ready')&&before.some(row=>row.phase==='ready-to-show'))break;await delay(100);}
  const phases=before.map(row=>row.phase);
  assert(phases.includes('ready-to-show'),'화면 준비가 끝나야 합니다. 관측 단계 / '+phases.join(', '));
  assert(phases.includes('bootstrap-ready'),'설정과 프로젝트를 읽어야 합니다. 관측 단계 / '+phases.join(', '));
  result.readyToShow=true;result.bootstrapReady=true;
  const apps=await applications(),matches=[];for(const app of apps){try{const command=(await run('/bin/ps',['-p',String(app.pid),'-o','command='],{timeout:5000})).stdout;if(command.includes(profile))matches.push(app);}catch{}}
  assert.equal(matches.length,1);pid=matches[0].pid;const started=Date.now();assert.equal((await requestQuit()).requested,true);result.normalQuitRequested=true;
  while(Date.now()-started<15000&&await live())await delay(100);remaining=await live();const after=await stages();result.quitStages=after.filter(row=>row.phase.startsWith('quit-')||row.phase==='closed').map(row=>({phase:row.phase,windows:row.windows}));result.remainingAfter15Seconds=remaining;result.observedMilliseconds=Date.now()-started;assert(after.some(row=>row.phase==='quit-finished'),'저장 및 정리를 마친 뒤 종료 단계에 도달해야 한다');
  if(expectedResident)assert(remaining,'기존 정상 종료 후 프로세스 잔류가 재현되어야 한다');else assert(!remaining,'정상 종료 후 프로세스가 남아서는 안 된다');
  const reloaded=new Store(profile);await reloaded.load();assert.equal(reloaded.session(session.id).messages[0].text,'정상 종료 후에도 보존할 합성 문장');result.runs.push({iteration:iteration+1,remaining,storageReloadPassed:true,quitPhases:result.quitStages.map(row=>row.phase),observedMilliseconds:result.observedMilliseconds});
  }
  console.log(expectedResident?'LaunchServices / 디버거 없는 합성 앱 / 저장 완료 뒤 종료 프로세스 잔류 재현':'LaunchServices / 디버거 없는 합성 앱 / 창 준비와 bootstrap / 정상 종료와 프로세스 정리 통과');
 }finally{
  if(pid&&await live()){try{await requestQuit();await delay(3000);}catch{}remaining=await live();}
  result.remainingAfterSecondNormalQuit=remaining;
  if(!remaining){if(archive)await run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-u',appPath]).catch(()=>{});await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:100});}else result.retainedSyntheticFixture=true;
  await fs.writeFile(path.join(qa,(expectedResident?'mac-quit-baseline':'mac-quit-result')+(archive?'-packaged':'-source')+(patched?'-candidate':'')+'.json'),JSON.stringify(result,null,2)+'\n');
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
