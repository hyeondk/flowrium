const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{gzipSync}=require('node:zlib');
const {relative,parseArchive,extractSource,peArchitecture}=require('../scripts/installer-support.cjs');
const {archive,source}=require('./installer-fixtures.cjs');
test('소스는 제품·버전과 필수 빌드 절차를 검증한 뒤 새 폴더에만 추출한다',async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-installer-support-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));const file=path.join(temp,'source.tar.gz');await fs.writeFile(file,archive(source()));const result=await extractSource(file,path.join(temp,'out'),'0.4.0');assert.equal(JSON.parse(await fs.readFile(path.join(result,'package.json'))).version,'0.4.0');await assert.rejects(extractSource(file,path.join(temp,'out'),'0.4.0'));await assert.rejects(extractSource(file,path.join(temp,'wrong'),'0.4.1'),/버전/);
});
test('소스의 상위·절대·중복 경로, 링크, 특수 파일과 잘못된 헤더를 추출 전에 차단한다',()=>{
 for(const value of ['/tmp/file','../file','root/../file','root\\file','root/C:file','root/.git/config','root/node_modules/file','root/.flowrium-tmp/file'])assert.throws(()=>relative(value),/경로/);
 for(const row of [{name:'../outside'},{name:'/outside'},{name:'root/link',type:'2'},{name:'root/hardlink',type:'1'},{name:'root/device',type:'3'}])assert.throws(()=>parseArchive(archive([row])));
 assert.throws(()=>parseArchive(archive([{name:'root/file'},{name:'root/file'}])),/중복/);assert.throws(()=>parseArchive(archive([{name:'root/file'},{name:'root/file/child'}])),/폴더/);assert.throws(()=>parseArchive(Buffer.from('변조된 압축')),/압축/);
 const data=require('node:zlib').gunzipSync(archive(source()));data[5]^=1;assert.throws(()=>parseArchive(gzipSync(data)),/헤더/);assert.throws(()=>parseArchive(gzipSync(data.subarray(0,512))),/헤더|확인/);
});
test('실행 파일 아키텍처를 이름 대신 실제 PE 헤더에서 읽고 잘못된 형식을 거절한다',()=>{
 const pe=machine=>{const b=Buffer.alloc(128);b.write('MZ');b.writeUInt32LE(80,60);b.write('PE\0\0',80,'binary');b.writeUInt16LE(machine,84);return b;};assert.equal(peArchitecture(pe(0x8664)),'x64');assert.equal(peArchitecture(pe(0xaa64)),'arm64');assert.equal(peArchitecture(pe(0x14c)),'x86');assert.throws(()=>peArchitecture(Buffer.from('임의 실행 파일')),/형식/);const bad=pe(0x8664);bad.writeUInt32LE(999,60);assert.throws(()=>peArchitecture(bad),/형식/);
});
test('날짜 소스 묶음은 공개 버전과 내부 패키지 버전을 함께 검증한다',async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-dated-source-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 const entries=source('26.11.1401').map(row=>({...row,name:row.name.replace('Flowrium-0.4.0','Flowrium-261114_01'),...(row.name.endsWith('/package.json')?{body:JSON.stringify({name:'flowrium',version:'26.11.1401',flowriumVersion:'261114_01'})}:{})}));
 const file=path.join(temp,'source.tar.gz');await fs.writeFile(file,archive(entries));const result=await extractSource(file,path.join(temp,'out'),'261114_01');assert.equal(JSON.parse(await fs.readFile(path.join(result,'package.json'))).flowriumVersion,'261114_01');await assert.rejects(extractSource(file,path.join(temp,'bad'),'261114_02'),/버전/);
});
test('실제 Git 소스 묶음의 전역 확장 헤더와 잠금 파일을 안전하게 처리한다',async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-installer-git-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));const folder=path.join(temp,'repo');await fs.mkdir(folder);for(const row of source().filter(r=>r.type!=='5')){const file=path.join(folder,...row.name.split('/').slice(1));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,row.body);}
 const exec=require('node:util').promisify(require('node:child_process').execFile),git=(...args)=>exec('git',args,{cwd:folder,encoding:'buffer',maxBuffer:8*1024*1024});await git('init');await git('add','.');await git('-c','user.name=검증','-c','user.email=test@example.invalid','commit','-m','소스 묶음');const {stdout}=await git('archive','--format=tar.gz','--prefix=Flowrium-0.4.0/','HEAD');const file=path.join(temp,'source.tar.gz');await fs.writeFile(file,stdout);const output=await extractSource(file,path.join(temp,'out'),'0.4.0');assert.equal(JSON.parse(await fs.readFile(path.join(output,'package.json'))).name,'flowrium');
});
