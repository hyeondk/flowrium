const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { readJSON, createJSON, UUID } = require("./project-store.cjs");
const stale = () =>
  new Error("계정이 바뀌었습니다. 현재 화면에서 초안을 다시 확인해 주세요.");
function validKey(key) {
  const [kind, id, ...extra] = key.split(":");
  return (
    !extra.length &&
    ((kind === "project" && id === "unassigned") ||
      (["project", "session"].includes(kind) && UUID.test(id)))
  );
}
const inlineCharacters = 1024;
function checked(input, {deletion = false, references = false} = {}) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length > 10000
  )
    throw new Error("초안 목록 형식을 확인해 주세요.");
  const result = {};
  for (const [k, v] of Object.entries(input)) {
    if (!validKey(k))
      throw new Error("초안의 대화 또는 프로젝트 식별자를 확인해 주세요.");
    if (deletion && v === null) {
      result[k] = null;
      continue;
    }
    const external = references && typeof v?.source === "string" && UUID.test(v.source)
      && Number.isSafeInteger(v.length) && v.length >= 0 && v.text === undefined;
    if (!v || (!external && typeof v.text !== "string") || !["plan","build","review"].includes(v.mode))
      throw new Error("초안의 내용과 작업 모드를 확인해 주세요.");
    result[k] = {
      ...(external ? {source:v.source, length:v.length} : {text:v.text}),
      mode:v.mode,
      ...(v.attachments?.length ? {attachments:require("./chat-attachments.cjs").checkedAttachments(v.attachments)} : {}),
      ...(v.codexReferences!==undefined && {codexReferences:require('./codex-plugins.cjs').checkedReferences(v.codexReferences)}),
    };
  }
  return result;
}
class Drafts {
  constructor(directory, security, controller) {
    this.directory = path.join(directory, "composer-drafts");
    this.security = security;
    this.controller = controller;
    this.queue = Promise.resolve();
    this.migration = Promise.resolve();
    this.known = false;
    controller.accountObserved = async (account, linkAccount = false) => {
      const changed = await security.accountOwner(account, false, linkAccount);
      this.known = true;
      return changed;
    };
  }
  async directoryReady() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (!(await fs.lstat(this.directory)).isDirectory())
      throw new Error("초안 보관 폴더가 올바르지 않습니다.");
  }
  async identity() {
    if (this.known) return;
    if (!this.identifying)
      this.identifying = (async () => {
        await this.controller.client.start(
          this.controller.store.state.settings.codexPath,
        );
        const result = await this.controller.client.request("account/read", {
          refreshToken: false,
        });
        await this.controller.accountObserved(result.account);
      })().finally(() => {
        this.identifying = null;
      });
    await this.identifying;
  }
  serial(action) {
    const r = this.queue.then(action);
    this.queue = r.catch(() => {});
    return r;
  }
  beginMigration(contents) {
    this.migration = new Promise((resolve) => {
      contents.once("did-finish-load", resolve);
    }).then(async () => {
      const source = await contents.executeJavaScript(
        'localStorage.getItem("flowrium.drafts")',
      );
      const preserved = await this.migrate(source);
      if (preserved && source !== null)
        await contents.executeJavaScript(
          `if (localStorage.getItem("flowrium.drafts") === ${JSON.stringify(source)}) localStorage.removeItem("flowrium.drafts")`,
        );
    });
    this.migration.catch(() => {});
  }
  async migrate(source) {
    await this.directoryReady();
    const file = path.join(this.directory, "legacy.json");
    // 쓰기 완료를 먼저 확인한다. 다음 기동에서 같은 원본을 발견해도 다시 주입하지 않는다.
    try {
      await createJSON(file, {
        version: 1,
        revision: this.security.accountRevision,
        source,
      });
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      // 이미 보관한 원문과 다른 새 값은 덮어쓰거나 지우지 않습니다.
      const prior = await readJSON(file);
      return prior.version === 1 && prior.source === source;
    }
  }
  async manifest(revision) {
    const file = path.join(this.directory, String(revision) + ".json");
    try {
      const data = await readJSON(file,{maxBytes:128*1024*1024});
      if (![1,2].includes(data.version) || data.revision !== revision) throw stale();
      return checked(data.drafts,{references:data.version===2});
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const legacy = await readJSON(path.join(this.directory, "legacy.json"));
    if (
      revision !== 0 ||
      legacy.revision !== 0 ||
      typeof legacy.source !== "string"
    )
      return {};
    let old;
    try {
      old = JSON.parse(legacy.source);
      return checked(old);
    } catch {
      throw new Error(
        "기존 초안을 읽지 못했습니다. 원본은 이 기기의 초안 보관 폴더에 유지됩니다.",
      );
    }
  }
  sourceFile(revision,source) {
    return path.join(this.directory, revision + "." + source + ".draft");
  }
  async storeText(revision,text) {
    const source=randomUUID(), file=this.sourceFile(revision,source);
    const handle=await fs.open(file,"wx",0o600);
    try {
      try {
        // UTF-16 preserves each editor code unit, including a composition boundary.
        const chunkSize=256*1024;
        for (let at=0;at<text.length;at+=chunkSize)
          await handle.writeFile(text.slice(at,at+chunkSize),{encoding:"utf16le"});
        await handle.sync();
      } finally { await handle.close(); }
      return {source,length:text.length};
    } catch(error) {
      await fs.rm(file,{force:true}).catch(()=>{});
      throw error;
    }
  }
  async prior(revision) {
    const next=await this.manifest(revision);
    for (const [key,draft] of Object.entries(next)) {
      if (!draft.source) continue;
      const file=this.sourceFile(revision,draft.source);
      const info=await fs.lstat(file);
      if (!info.isFile() || info.size!==draft.length*2) throw Error("초안 원문 파일을 확인해 주세요.");
      const {source,length,...meta}=draft;
      const text=await fs.readFile(file,"utf16le");
      if (text.length!==length) throw Error("초안 원문이 변경되었습니다. 다시 열어 주세요.");
      next[key]={...meta,text};
    }
    return next;
  }
  async verify(revision) {
    await this.migration;
    await this.identity();
    if (
      !Number.isSafeInteger(revision) ||
      revision !== this.security.accountRevision ||
      this.security.loggingOut
    )
      throw stale();
    if (this.security.locked) throw new Error("화면이 잠겼습니다.");
  }
  read(revision) {
    this.pendingWrite=null;
    return this.serial(async () => {
      await this.verify(revision);
      const result=await this.prior(revision);
      await this.verify(revision);
      return result;
    });
  }
  write(revision,patch) {
    const changes=checked(patch,{deletion:true});
    if (this.pendingWrite?.revision===revision) {
      Object.assign(this.pendingWrite.changes,changes);
      return this.pendingWrite.done;
    }
    const batch={revision,changes};
    this.pendingWrite=batch;
    batch.done=this.serial(async()=>{
      if (this.pendingWrite===batch) this.pendingWrite=null;
      await this.verify(revision);
      const next=await this.manifest(revision), added=[], removed=[];
      const target=path.join(this.directory,String(revision)+".json");
      const tmp=target+"."+randomUUID()+".tmp";
      let committed=false;
      try {
        for (const [key,value] of Object.entries(batch.changes)) {
          if (next[key]?.source) removed.push(next[key].source);
          if (value===null) delete next[key];
          else if (value.text.length>inlineCharacters) {
            const {text,...meta}=value;
            const ref=await this.storeText(revision,text);
            added.push(ref.source);next[key]={...meta,...ref};
          } else next[key]=value;
        }
        const drafts=checked(next,{references:true});
        await createJSON(tmp,{version:2,revision,drafts},{maxBytes:128*1024*1024});
        await this.verify(revision);
        await fs.rename(tmp,target);
        committed=true;
      } finally {
        await fs.rm(tmp,{force:true}).catch(()=>{});
        for (const source of committed ? removed : added)
          await fs.rm(this.sourceFile(revision,source),{force:true}).catch(()=>{});
      }
    });
    return batch.done;
  }
}
function registerDrafts(register, drafts) {
  register("readDrafts", (revision) => drafts.read(revision));
  register("writeDrafts", (revision, input) => drafts.write(revision, input));
}
module.exports = { Drafts, registerDrafts };
