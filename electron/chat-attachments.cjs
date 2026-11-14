const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID, createHash} = require('node:crypto');
const {UUID, projectDirectory, createJSON, readJSON} = require('./project-store.cjs');
const MAX_FILE = 20 * 1024 * 1024, MAX_TOTAL = 50 * 1024 * 1024, MAX_FILES = 10;
function checkedAttachments(items = []) {
  if (!Array.isArray(items) || items.length > MAX_FILES) throw Error('첨부는 한 번에 10개까지 선택할 수 있습니다.');
  return items.map(a => {
    if (!a || !UUID.test(a.id) || typeof a.name !== 'string' || !a.name || a.name.length > 250 || /[\\/\0<>:"|?*]/.test(a.name) ||
      typeof a.type !== 'string' || a.type.length > 150 || !Number.isSafeInteger(a.size) || a.size < 1 || a.size > MAX_FILE ||
      !/^[a-f0-9]{64}$/.test(a.sha256)) throw Error('첨부 파일 정보를 확인해 주세요.');
    return {id:a.id,name:a.name,type:a.type,size:a.size,sha256:a.sha256};
  });
}
function imageType(data) {
  if (data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (data.toString('ascii',0,4)==='RIFF' && data.toString('ascii',8,12)==='WEBP') return 'image/webp';
  if (['GIF87a','GIF89a'].includes(data.toString('ascii',0,6))) return 'image/gif';
}
async function attachmentRoot(store, projectId) {
  const project = store.project(projectId), root = path.join(project.path,'.flowrium');
  await projectDirectory(root);
  if ((await readJSON(path.join(root,'project.json'))).id !== project.id) throw Error('프로젝트 식별자가 바뀌었습니다. 첨부 원본은 보존됩니다.');
  const directory = path.join(root,'attachments');
  await projectDirectory(directory);
  return directory;
}
async function addAttachments(store, projectId, files) {
  const project=store.project(projectId);
  if (!Array.isArray(files) || !files.length || files.length > MAX_FILES) throw Error('첨부 파일을 1개에서 10개까지 선택해 주세요.');
  let total = 0;
  const prepared = files.map(file => {
    if (!file || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 250 || /[\\/\0<>:"|?*]/.test(file.name) || ['.','..','attachment.json'].includes(file.name)||/[. ]$/.test(file.name)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(file.name)) throw Error('첨부 파일 이름을 확인해 주세요.');
    const bytes = file.bytes;
    if (!(bytes instanceof Uint8Array) && !Buffer.isBuffer(bytes)) throw Error('첨부 파일 내용을 확인해 주세요.');
    const data = Buffer.from(bytes);
    if (!data.length || data.length > MAX_FILE) throw Error('첨부 파일은 한 개당 20MB까지 보낼 수 있습니다.');
    total += data.length;
    if (total > MAX_TOTAL) throw Error('한 번에 첨부하는 파일은 모두 합해 50MB까지 보낼 수 있습니다.');
    const type = imageType(data) || (typeof file.type === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(file.type) && !file.type.startsWith('image/') ? file.type : 'application/octet-stream');
    return {id:randomUUID(),name:file.name,type,size:data.length,sha256:createHash('sha256').update(data).digest('hex'),data};
  });
  const root = await attachmentRoot(store,projectId), created = [];
  try {
    for (const file of prepared) {
      const dir = path.join(root,file.id);
      await fs.mkdir(dir,{mode:0o700}); created.push(dir);
      await fs.writeFile(path.join(dir,file.name),file.data,{flag:'wx',mode:0o600});
      const {data,...record}=file;
      await createJSON(path.join(dir,'attachment.json'),record);
    }
    if(store.project(projectId)!==project)throw Error('첨부 중 계정이나 프로젝트가 바뀌었습니다. 다시 첨부해 주세요.');
    return prepared.map(({data,...a})=>a);
  } catch(error) {
    for (const dir of created) await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
    throw error;
  }
}
async function resolveAttachments(store,projectId,ids=[]) {
  const project=store.project(projectId);
  if (!Array.isArray(ids) || ids.length > MAX_FILES || ids.some(id=>typeof id!=='string'||!UUID.test(id)) || new Set(ids).size!==ids.length) throw Error('첨부 파일 식별자를 확인해 주세요.');
  if (!ids.length) return [];
  const root = await attachmentRoot(store,projectId), result=[];
  let total=0;
  for(const id of ids) {
    const dir=path.join(root,id), stat=await fs.lstat(dir);
    if (!stat.isDirectory()||stat.isSymbolicLink()||path.relative(root,await fs.realpath(dir))!==id) throw Error('첨부 파일은 프로젝트 안의 원본이어야 합니다.');
    const [record]=checkedAttachments([await readJSON(path.join(dir,'attachment.json'))]);
    if(record.id!==id) throw Error('첨부 파일 정보가 바뀌었습니다.');
    const file=path.join(dir,record.name), fileStat=await fs.lstat(file);
    if(!fileStat.isFile()||fileStat.isSymbolicLink()||fileStat.size!==record.size||path.relative(dir,await fs.realpath(file)).normalize('NFC')!==record.name.normalize('NFC')) throw Error('첨부 파일 원본을 확인해 주세요.');
    total+=fileStat.size;if(total>MAX_TOTAL)throw Error('첨부 합계가 50MB를 넘었습니다.');
    const data=await fs.readFile(file);
    if(createHash('sha256').update(data).digest('hex')!==record.sha256) throw Error('첨부 파일 내용이 변경됐습니다. 다시 첨부해 주세요.');
    result.push({...record,path:file,image:Boolean(imageType(data)),...(imageType(data)&&data.length<=2*1024*1024?{dataUrl:`data:${imageType(data)};base64,${data.toString('base64')}`}:{})});
  }
  if(store.project(projectId)!==project)throw Error('첨부를 읽는 중 계정이나 프로젝트가 바뀌었습니다. 다시 확인해 주세요.');
  return result;
}
function registerChatAttachments(register,store) {
  register('addChatAttachments',(projectId,files)=>addAttachments(store,projectId,files));
  register('readChatAttachment',async(projectId,id)=>{
    const [file]=await resolveAttachments(store,projectId,[id]);
    const {path:_,image,dataUrl,...attachment}=file;
    return {attachment,...(dataUrl?{dataUrl}:{})};
  });
}
module.exports={MAX_FILE,MAX_TOTAL,MAX_FILES,checkedAttachments,addAttachments,resolveAttachments,registerChatAttachments};
