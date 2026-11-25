// A chat request is immutable UTF-8 text. Its attachment-shaped reference also
// opens older saved transcripts, without granting binary attachments a larger limit.
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash,randomUUID} = require('node:crypto');
const {UUID, createJSON, readJSON} = require('./project-store.cjs');
const {attachmentRoot, checkedAttachments, MAX_FILE} = require('./chat-attachments.cjs');
const {samePath} = require('./path-boundary.cjs');

const PAGE = 12000;
const indices = new Map();
const invalid = () => Error('저장한 긴 요청 원문이 변경됐거나 올바르지 않습니다.');
const staleIndex = () => Object.assign(invalid(),{code:'REQUEST_SOURCE_INDEX_STALE'});
const invalidText = () => Error('입력한 글에 저장할 수 없는 문자가 있습니다.');
function sourceId(hash) {
  return [hash.slice(0,8),hash.slice(8,12),'8'+hash.slice(13,16),'a'+hash.slice(17,20),hash.slice(20,32)].join('-');
}
function checkedRequestSource(source) {
  if (!source || source.name!=='request.txt' || source.type!=='text/plain' ||
    !Number.isSafeInteger(source.size) || source.size<1 || !UUID.test(source.id) || !/^[a-f0-9]{64}$/.test(source.sha256)) throw invalid();
  if (source.id!==sourceId(source.sha256)) {
    // Older request-sized text attachments used ordinary random attachment IDs.
    if(source.size>MAX_FILE) throw invalid();
    checkedAttachments([source]);
  }
  const {id,name,type,size,sha256} = source;
  return {id,name,type,size,sha256};
}
function chunksOf(value) {
  if (typeof value!=='string') {
    if (!value?.[Symbol.asyncIterator] || Buffer.isBuffer(value)) throw invalidText();
    return value;
  }
  if (!value.isWellFormed()) throw invalidText();
  return (function*(){
    for(let pos=0; pos<value.length;) {
      let end=Math.min(value.length,pos+65536);
      if(end<value.length && /[\uD800-\uDBFF]/.test(value[end-1])) end--;
      yield Buffer.from(value.slice(pos,end),'utf8');
      pos=end;
    }
  })();
}
function version(stat) {
  return [stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');
}
async function indexBytes(chunks,write,guard) {
  const hash=createHash('sha256'), decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
  const pages=[];
  let pending='', size=0, byteOffset=0, characters=0, nonblank=false;
  function page(text) {
    const bytes=Buffer.from(text,'utf8');
    pages.push({offset:byteOffset,bytes:bytes.length,character:characters,hash:createHash('sha256').update(bytes).digest('hex')});
    byteOffset+=bytes.length;
    characters+=text.length;
  }
  for await (const bytes of chunks) {
    if (!(bytes instanceof Uint8Array)) throw invalidText();
    await guard?.();
    let text;
    try {text=decoder.decode(bytes,{stream:true});} catch {throw invalidText();}
    if(text.includes('\0')) throw invalidText();
    if(!nonblank && /\S/u.test(text)) nonblank=true;
    hash.update(bytes);size+=bytes.length;
    if (!Number.isSafeInteger(size)) throw invalidText();
    if(write) await write(bytes);
    pending+=text;
    let pos=0;
    while(pending.length-pos>=PAGE) {
      let end=pos+PAGE;
      if (/[\uD800-\uDBFF]/.test(pending[end-1])) end--;
      page(pending.slice(pos,end));pos=end;
    }
    pending=pending.slice(pos);
  }
  try {pending+=decoder.decode();} catch {throw invalidText();}
  if(!nonblank)throw Error('보낼 내용을 입력해 주세요.');
  if(pending)page(pending);
  if(byteOffset!==size)throw invalidText();
  return {size,sha256:hash.digest('hex'),pages,characters};
}
function remember(filename,entry) {
  indices.delete(filename);
  indices.set(filename,entry);
  while(indices.size>8) indices.delete(indices.keys().next().value);
}
async function sourceRecord(store,projectId,id,includeBytes=false,guard) {
  if(!UUID.test(id))throw invalid();
  const project=store.project(projectId);
  const root=await attachmentRoot(store,projectId);
  const directory=path.join(root,id), filename=path.join(directory,'request.txt');
  if (!(await fs.lstat(directory)).isDirectory() || !samePath(await fs.realpath(filename),filename)) throw invalid();
  const ref=checkedRequestSource(await readJSON(path.join(directory,'attachment.json')));
  if(ref.id!==id)throw invalid();
  const stat=await fs.lstat(filename,{bigint:true});
  if(!stat.isFile() || BigInt(ref.size)!==stat.size)throw invalid();
  const identity=version(stat);
  let index=indices.get(filename);
  if(!index || index.version!==identity || index.sha256!==ref.sha256) {
    const handle=await fs.open(filename,'r');
    try{
      if(version(await handle.stat({bigint:true}))!==identity)throw invalid();
      const value=await indexBytes(handle.createReadStream({autoClose:false}),null,guard);
      if(value.sha256!==ref.sha256 || value.size!==ref.size || version(await handle.stat({bigint:true}))!==identity)throw invalid();
      index={...value,version:identity};remember(filename,index);
    }finally{await handle.close();}
  }
  const file={...ref,path:filename,index,async refreshIndex(check){
    await check?.();
    if(store.project(projectId)!==project)throw invalid();
    const current=await sourceRecord(store,projectId,id,false,check);
    if(!samePath(current.path,filename) || current.sha256!==ref.sha256 || current.size!==ref.size)throw invalid();
    await check?.();
    if(store.project(projectId)!==project)throw invalid();
    file.index=current.index;
  }};
  if(includeBytes){
    const bytes=await fs.readFile(filename);
    if(createHash('sha256').update(bytes).digest('hex')!==ref.sha256)throw invalid();
    file.bytes=bytes;
  }
  if(store.project(projectId)!==project)throw invalid();
  return file;
}
async function readIndexedPage(filename,index,number) {
  const page=index.pages[number];
  if(!page)throw invalid();
  const handle=await fs.open(filename,'r');
  try{
    if(version(await handle.stat({bigint:true}))!==index.version)throw staleIndex();
    const data=Buffer.allocUnsafe(page.bytes);
    let filled=0;
    while(filled<data.length){
      const {bytesRead}=await handle.read(data,filled,data.length-filled,page.offset+filled);
      if(!bytesRead)throw invalid();
      filled+=bytesRead;
    }
    if(version(await handle.stat({bigint:true}))!==index.version)throw staleIndex();
    if(createHash('sha256').update(data).digest('hex')!==page.hash)throw invalid();
    return data.toString('utf8');
  }finally{await handle.close();}
}
async function filePage(file,number,guard) {
  const index=file.index;
  try{return await readIndexedPage(file.path,index,number);}
  catch(error){
    if(error.code!=='REQUEST_SOURCE_INDEX_STALE')throw error;
    // Cloud sync can replace a file with identical bytes. Share the full
    // digest check before retrying simultaneous page reads against it.
    if(file.index===index){
      file.refreshing ??= file.refreshIndex(guard).finally(()=>{file.refreshing=undefined;});
      await file.refreshing;
    }
    await guard?.();
    return readIndexedPage(file.path,file.index,number);
  }
}
// Unsent mobile uploads belong to the local app profile. Only confirmed requests
// enter the portable project. Startup holds Electron's single-instance lock.
const activeStages = new Set();
async function mobileStageRoot(store) {
  return path.join(await fs.realpath(path.dirname(store.file)),'mobile-request-staging-v1');
}
async function cleanupMobileRequestStages(store) {
  const root=await mobileStageRoot(store);
  try {
    if (!(await fs.lstat(root)).isDirectory()) return;
  } catch(error) { if(error.code==='ENOENT')return; throw error; }
  for (const entry of await fs.readdir(root,{withFileTypes:true})) {
    if (!entry.isDirectory() || !entry.name.startsWith('upload-') || !UUID.test(entry.name.slice(7))) continue;
    const directory=path.join(root,entry.name);
    if(activeStages.has(directory))continue;
    const files=await fs.readdir(directory,{withFileTypes:true});
    const owned=await Promise.all(files.map(async file=>{
      if(file.isFile())return file.name==='request.txt'||file.name==='attachment.json'||
        file.name.startsWith('.flowrium-write-')&&file.name.endsWith('.tmp')&&UUID.test(file.name.slice(16,-4));
      if(!file.isDirectory()||!/^\.flowrium-write-[a-z0-9]{6}$/i.test(file.name))return false;
      const records=await fs.readdir(path.join(directory,file.name),{withFileTypes:true});
      return records.every(record=>record.isFile()&&record.name==='record.tmp');
    }));
    if(owned.every(Boolean))
      await fs.rm(directory,{recursive:true,force:true});
  }
}
async function newMobileStage(store) {
  const root=await mobileStageRoot(store);
  await fs.mkdir(root,{recursive:true,mode:0o700});
  if(!(await fs.lstat(root)).isDirectory())throw invalid();
  const stage=path.join(root,'upload-'+randomUUID());
  activeStages.add(stage);
  try {await fs.mkdir(stage,{mode:0o700});return stage;}
  catch(error){activeStages.delete(stage);throw error;}
}
async function publishStage(store,projectId,stage,record,index,check) {
  await check();
  const root=await attachmentRoot(store,projectId),target=path.join(root,record.id);
  async function verifyExisting() {
    const existing=await sourceRecord(store,projectId,record.id);
    if(existing.sha256!==record.sha256 || existing.size!==record.size)throw invalid();
  }
  async function install(directory) {
    await check();
    try { await fs.rename(directory,target); }
    catch(error){
      if(!['EEXIST','ENOTEMPTY','EPERM'].includes(error.code))throw error;
      await verifyExisting();
      return;
    }
    const published=path.join(target,record.name), stat=await fs.lstat(published,{bigint:true});
    if(!stat.isFile() || stat.size!==BigInt(index.size))throw invalid();
    remember(published,{...index,version:version(stat)});
  }
  try { await install(stage); }
  catch(error){
    if(error.code!=='EXDEV')throw error;
    // A project may live on a separate drive. Stage on that drive and verify
    // the copy before making the deterministic ID visible.
    const local=await fs.mkdtemp(path.join(root,'.request-'));
    try{
      const filename=path.join(local,record.name);
      await fs.copyFile(path.join(stage,record.name),filename);
      const copy=await fs.open(filename,'r+');
      try{
        const verified=await indexBytes(copy.createReadStream({autoClose:false}),null,check);
        if(verified.sha256!==record.sha256 || verified.size!==record.size)throw invalid();
        await copy.sync();
      }finally{await copy.close();}
      await createJSON(path.join(local,'attachment.json'),record);
      await install(local);
    }finally{await fs.rm(local,{recursive:true,force:true});}
  }
  await check();
  return record;
}
async function storeRequestSource(store,projectId,content,{guard,defer=false,onStagedBytes}={}) {
  const project=store.project(projectId),originalPath=project.path;
  const check=async()=>{
    await guard?.();
    if(store.project(projectId)!==project || !samePath(project.path,originalPath))
      throw Error('요청 원문을 저장하는 동안 프로젝트 또는 계정이 바뀌었습니다.');
  };
  await check();
  const stage=defer ? await newMobileStage(store) : await fs.mkdtemp(path.join(await attachmentRoot(store,projectId),'.request-'));
  let cleaning;
  const cleanup=()=>cleaning??=fs.rm(stage,{recursive:true,force:true}).finally(()=>activeStages.delete(stage));
  try{
    const filename=path.join(stage,'request.txt'), handle=await fs.open(filename,'wx',0o600);
    let index;
    try{
      index=await indexBytes(chunksOf(content),async bytes=>{
        await handle.writeFile(bytes);
        onStagedBytes?.(bytes.length);
      },check);
      await handle.sync();
    }finally{await handle.close();}
    const identity=version(await fs.lstat(filename,{bigint:true}));
    const record={id:sourceId(index.sha256),name:'request.txt',type:'text/plain',size:index.size,sha256:index.sha256};
    await createJSON(path.join(stage,'attachment.json'),record);
    await check();
    let abandoned=false,publication;
    function publish(){
      if(abandoned)return Promise.reject(Error('취소된 원문 전송입니다. 다시 보내 주세요.'));
      if(!publication)publication=(async()=>{
        if(version(await fs.lstat(filename,{bigint:true}))!==identity)throw invalid();
        return publishStage(store,projectId,stage,record,index,check);
      })().finally(cleanup);
      return publication;
    }
    function discard(){
      if(publication)return publication.then(()=>{},()=>{});
      abandoned=true;
      return cleanup();
    }
    return defer ? {...record,publish,discard} : await publish();
  }catch(error){await cleanup();throw error;}
}
module.exports={sourceId,storeRequestSource,checkedRequestSource,sourceRecord,filePage,cleanupMobileRequestStages};
