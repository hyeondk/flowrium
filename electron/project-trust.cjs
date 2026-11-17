const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {samePath, pathForComparison} = require('./path-boundary.cjs');
const {createJSON} = require('./project-store.cjs');

const untrusted = '컴퓨터에서 이 프로젝트 폴더를 먼저 신뢰해 주세요.';
class ProjectTrust {
  constructor(directory, lookup, owner) {
    this.directory = path.join(directory, 'project-trust-v1');
    this.lookup = lookup;
    this.owner = owner;
    this.pending = new Map();
  }
  async identity(id) {
    const project = this.lookup(id), owner = this.owner();
    if (!project || project.conversationScope || !owner || owner === 'signed-out') throw Error(untrusted);
    const root = await fs.realpath(project.path);
    if (!samePath(root, project.path) || samePath(root, path.parse(root).root)) throw Error(untrusted);
    const metadata = path.join(root, '.flowrium', 'project.json');
    if (!samePath(await fs.realpath(metadata), metadata)) throw Error(untrusted);
    const [folder, record] = await Promise.all([fs.stat(root,{bigint:true}),fs.readFile(metadata,'utf8')]);
    const projectRecord = JSON.parse(record);
    if (!folder.isDirectory() || projectRecord.id !== id || projectRecord.version !== 1) throw Error(untrusted);
    const canonical = pathForComparison(root);
    const key = createHash('sha256').update(JSON.stringify([owner,id,process.platform==='win32'?canonical.toLowerCase():canonical,String(folder.dev),String(folder.ino)])).digest('hex');
    return {key, name:project.name, path:root};
  }
  async granted(key) {
    try {
      const dir = await fs.lstat(this.directory);
      if (!dir.isDirectory()) return false;
      const file = path.join(this.directory,key+'.json');
      if (!(await fs.lstat(file)).isFile()) return false;
      const record = JSON.parse(await fs.readFile(file,'utf8'));
      return record.version === 1 && record.key === key;
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  async require(id) {
    const current = await this.identity(id);
    if (!await this.granted(current.key)) throw Error(untrusted);
    return current;
  }
  async request(id, confirm) {
    const current = await this.identity(id);
    if (await this.granted(current.key)) return true;
    if (this.pending.has(current.key)) return this.pending.get(current.key);
    const action = (async()=>{
      if (!await confirm({name:current.name, path:current.path})) return false;
      if ((await this.identity(id)).key !== current.key) throw Error(untrusted);
      await fs.mkdir(this.directory,{mode:0o700,recursive:true});
      if (!(await fs.lstat(this.directory)).isDirectory()) throw Error(untrusted);
      const file = path.join(this.directory,current.key+'.json');
      try { await createJSON(file,{version:1,key:current.key}); }
      catch (error) { if(error.code!=='EEXIST' || !await this.granted(current.key))throw error; }
      return true;
    })();
    this.pending.set(current.key,action);
    try { return await action; } finally { this.pending.delete(current.key); }
  }
}
module.exports = {ProjectTrust};
