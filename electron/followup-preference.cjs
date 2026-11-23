const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

const validAccountKey = value => typeof value === 'string' && /^\d{1,16}:[a-f0-9]{64}$/.test(value);

class FollowupPreference {
  #directory;
  #file;
  #accountKey = null;
  #queue = Promise.resolve();
  #pending = new Map();

  constructor(directory) {
    this.#directory = directory;
    this.#file = path.join(directory, 'followup-preference-v1.json');
  }

  #enqueue(operation) {
    const next = this.#queue.then(operation);
    this.#queue = next.catch(() => {});
    return next;
  }

  load() {
    return this.#enqueue(async () => {
      this.#accountKey = null;
      try {
        const info = await fs.lstat(this.#file);
        if (!info.isFile() || info.size > 1024) return;
        const value = JSON.parse(await fs.readFile(this.#file, 'utf8'));
        if (value?.version === 1 && validAccountKey(value.accountKey)) this.#accountKey = value.accountKey;
      } catch {
        // 사용자가 새로 동의하기 전까지 추천은 꺼진 상태로 둡니다.
      }
    });
  }

  enabled(accountKey) {
    return validAccountKey(accountKey) && this.#accountKey === accountKey && this.#pending.get(accountKey)?.value !== false;
  }

  async set(accountKey, value) {
    if (!validAccountKey(accountKey) || typeof value !== 'boolean')
      throw Error('모델 추천 설정을 확인해 주세요.');
    const intent = {value};
    this.#pending.set(accountKey, intent);
    return this.#enqueue(async () => {
      try {
        if (this.#pending.get(accountKey) !== intent) return this.enabled(accountKey);
        if (value ? this.#accountKey === accountKey : this.#accountKey !== accountKey) return value;
        const next = value ? accountKey : null;
        const temporary = this.#file + '.' + randomUUID() + '.tmp';
        try {
          await fs.mkdir(this.#directory, {recursive:true, mode:0o700});
          await fs.writeFile(temporary, JSON.stringify({version:1, accountKey:next}) + '\n', {mode:0o600, flag:'wx'});
          await fs.rename(temporary, this.#file);
          this.#accountKey = next;
        } catch {
          if (!value) this.#accountKey = null;
          throw Error('모델 추천 설정을 저장하지 못했습니다.');
        } finally {
          await fs.rm(temporary, {force:true}).catch(() => {});
        }
        return value;
      } finally {
        if (this.#pending.get(accountKey) === intent) this.#pending.delete(accountKey);
      }
    });
  }
}

module.exports = {FollowupPreference};
