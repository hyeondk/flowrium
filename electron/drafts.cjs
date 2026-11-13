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
function checked(input, deletion = false) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length > 10000
  )
    throw new Error("초안 목록 형식을 확인해 주세요.");
  let bytes = 0;
  const result = {};
  for (const [k, v] of Object.entries(input)) {
    if (!validKey(k))
      throw new Error("초안의 대화 또는 프로젝트 식별자를 확인해 주세요.");
    if (deletion && v === null) {
      result[k] = null;
      continue;
    }
    if (
      !v ||
      typeof v.text !== "string" ||
      v.text.length > 200000 ||
      !["plan", "build", "review"].includes(v.mode)
    )
      throw new Error("초안의 내용과 작업 모드를 확인해 주세요.");
    bytes += Buffer.byteLength(v.text, "utf8");
    if (bytes > 12 * 1024 * 1024)
      throw new Error(
        "이 기기에 보관한 초안이 12MB를 넘었습니다. 이전 초안을 정리해 주세요.",
      );
    result[k] = { text: v.text, mode: v.mode, ...(v.attachments?.length ? {attachments:require("./chat-attachments.cjs").checkedAttachments(v.attachments)} : {}) };
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
    controller.accountObserved = async (account) => {
      const changed = await security.accountOwner(account);
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
  async prior(revision) {
    const file = path.join(this.directory, String(revision) + ".json");
    try {
      const data = await readJSON(file);
      if (data.version !== 1 || data.revision !== revision) throw stale();
      return checked(data.drafts);
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
    return this.serial(async () => {
      await this.verify(revision);
      return this.prior(revision);
    });
  }
  write(revision, patch) {
    const changes = checked(patch, true);
    return this.serial(async () => {
      await this.verify(revision);
      const next = await this.prior(revision);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) delete next[key];
        else next[key] = value;
      }
      const drafts = checked(next);
      const file = path.join(this.directory, String(revision) + ".json"),
        tmp = file + "." + randomUUID() + ".tmp";
      try {
        await createJSON(tmp, { version: 1, revision, drafts });
        await fs.rename(tmp, file);
      } finally {
        await fs.unlink(tmp).catch(() => {});
      }
    });
  }
}
function registerDrafts(register, drafts) {
  register("readDrafts", (revision) => drafts.read(revision));
  register("writeDrafts", (revision, input) => drafts.write(revision, input));
}
module.exports = { Drafts, registerDrafts };
