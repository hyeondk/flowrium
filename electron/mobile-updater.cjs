const fs = require('node:fs/promises');
const {renameSync} = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {requestRelease, readSmall} = require('./updater.cjs');
const {dateVersion, parseReleaseTag, newer} = require('./version.cjs');

const releaseApi = 'https://api.github.com/repos/hyeondk/flowrium/releases/';
const downloadBase = 'https://github.com/hyeondk/flowrium/releases/download/';
const maxBundle = 4 * 1024 * 1024;
const required = ['index.html', 'app.js', 'navigation.js', 'style.css', 'mobile-shell.css', 'install.css', 'install.js', 'confirmation.js', 'mobile-update.js', 'sw.js', 'manifest.webmanifest', 'model-display.js', 'chatgpt.svg'];
const assetName = /^[a-z0-9][a-z0-9.-]{0,79}\.(js|css|html|webmanifest|svg)$/;

function compatibleAsset(release, version) {
  const name = 'Flowrium-' + version + '-mobile-v1.json';
  const assets = (release.assets || []).filter(asset => asset.name === name);
  if (assets.length === 0) return null;
  const [asset] = assets;
  if (assets.length !== 1 || asset.browser_download_url !== downloadBase + release.tag_name + '/' + name ||
      !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > maxBundle ||
      !/^sha256:[a-f0-9]{64}$/.test(asset.digest))
    throw Error('공개 릴리스의 모바일 파일 정보를 확인할 수 없습니다.');
  return {version, url:asset.browser_download_url, size:asset.size, digest:asset.digest};
}

function unpack(bytes, asset) {
  if (bytes.length !== asset.size || 'sha256:' + createHash('sha256').update(bytes).digest('hex') !== asset.digest)
    throw Error('모바일 파일의 크기 또는 무결성 검사에 실패했습니다.');
  const bundle = JSON.parse(bytes.toString('utf8'));
  const files = bundle?.files;
  if (bundle?.format !== 1 || bundle?.version !== asset.version || !files || typeof files !== 'object' || Array.isArray(files) ||
      !required.every(name => Object.hasOwn(files, name)) || typeof files['index.html'] !== 'string' ||
      !files['index.html'].includes('name="flowrium-mobile-version" content=""') ||
      Object.keys(files).length > 128 ||
      Object.entries(files).some(([name, value]) => !assetName.test(name) || typeof value !== 'string' || !value.length))
    throw Error('현재 데스크톱과 호환되는 모바일 화면 파일을 읽지 못했습니다.');
  return {version:asset.version, files:new Map(Object.entries(files)), bytes};
}

class MobileUpdater {
  constructor({version, directory, storage, fetchImpl = globalThis.fetch}) {
    this.builtinVersion = version;
    this.fetchImpl = fetchImpl;
    this.storage = storage;
    this.marker = directory && path.join(directory, 'mobile-ui-cache.json');
  }

  get version() { return this.active?.version || this.builtinVersion; }
  async release(endpoint) {
    const response = await requestRelease(this.fetchImpl, releaseApi + endpoint, AbortSignal.timeout(9000));
    if (response.status === 404) { await response.body?.cancel(); return null; }
    const data = JSON.parse((await readSmall(response, 2 * 1024 * 1024)).toString('utf8'));
    if (data.draft !== false || data.prerelease !== false || !parseReleaseTag(data.tag_name))
      throw Error('공개된 정식 업데이트의 버전을 확인할 수 없습니다.');
    return data;
  }

  async download(asset) {
    const response = await requestRelease(this.fetchImpl, asset.url, AbortSignal.timeout(12000));
    return unpack(await readSmall(response, asset.size), asset);
  }

  // Bind the verified public digest to this OS account. A writable cache alone
  // never authorizes replacement scripts, even when GitHub is offline.
  cacheRecord(asset, content) {
    const {version,digest,size} = asset;
    try {
      if (this.storage?.isEncryptionAvailable()) {
        const receipt = this.storage.encryptString(JSON.stringify({version,digest,size}));
        return JSON.stringify({version,receipt:receipt.toString('base64'),bytes:content.bytes.toString('base64')});
      }
    } catch { /* If OS storage is unavailable, verify the release online next time. */ }
    return JSON.stringify({version});
  }

  restore() {
    if (!this.restoring) this.restoring = this.restoreSelected().catch(() => {});
    return this.restoring;
  }

  async restoreSelected() {
    if (!this.marker) return;
    const info = await fs.lstat(this.marker);
    if (!info.isFile() || info.size > maxBundle * 2) return;
    const saved = JSON.parse(await fs.readFile(this.marker,'utf8'));
    const selected = saved?.version;
    if (!dateVersion(selected) || !newer(selected, this.builtinVersion)) return;
    if (typeof saved.receipt === 'string' && typeof saved.bytes === 'string' && this.storage?.isEncryptionAvailable()) {
      try {
        const asset = JSON.parse(this.storage.decryptString(Buffer.from(saved.receipt,'base64')));
        if (asset.version === selected) {
          this.active = unpack(Buffer.from(saved.bytes,'base64'),asset);
          return;
        }
      } catch { /* Recover a missing or damaged cache from the exact published tag. */ }
    }
    const release = await this.release('tags/' + selected);
    if (release?.tag_name !== selected) return;
    const asset = compatibleAsset(release, selected);
    if (asset) await this.activate(asset, await this.download(asset), () => {});
  }

  check() {
    if (!this.checking) this.checking = this.query().finally(() => { this.checking = null; });
    return this.checking;
  }

  async query() {
    await this.restore();
    const release = await this.release('latest');
    const latestVersion = release && parseReleaseTag(release.tag_name);
    const version = this.version;
    this.candidate = null;
    if (!latestVersion || !newer(latestVersion, version)) return {status:'current', version, latestVersion:version};
    this.candidate = compatibleAsset(release, latestVersion);
    return {status:this.candidate ? 'available' : 'desktop-required', version, latestVersion};
  }

  async apply(version, stillAuthorized) {
    await this.restore();
    stillAuthorized();
    if (version === this.version) return {status:'current', version, latestVersion:version};
    const asset = this.candidate;
    if (!asset || version !== asset.version || !newer(version, this.version)) throw Error('새 버전을 다시 확인해 주세요.');
    if (!this.downloading || this.downloading.asset.digest !== asset.digest) {
      const transfer = {asset, result:this.download(asset)};
      this.downloading = transfer;
      transfer.result.finally(() => { if (this.downloading === transfer) this.downloading = null; }).catch(() => {});
    }
    const content = await this.downloading.result;
    await this.activate(asset,content,stillAuthorized);
    return {status:'current', version:this.version, latestVersion:this.version};
  }

  async activate(asset, content, stillAuthorized) {
    stillAuthorized();
    const temporary = this.marker && this.marker + '.' + randomUUID() + '.tmp';
    try {
      if (temporary) await fs.writeFile(temporary, this.cacheRecord(asset,content), {flag:'wx', mode:0o600});
      stillAuthorized();
      if (newer(asset.version, this.version)) {
        if (temporary) renameSync(temporary, this.marker);
        this.active = content;
      }
    } finally {
      if (temporary) await fs.rm(temporary, {force:true}).catch(() => {});
    }
  }

  contents(name) { return this.active?.files.get(name); }
}

module.exports = {MobileUpdater};
