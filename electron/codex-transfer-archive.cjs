const {constants, createWriteStream} = require('node:fs');
const fs = require('node:fs/promises');
const {createHash} = require('node:crypto');
const path = require('node:path');
const {Readable} = require('node:stream');
const {pipeline} = require('node:stream/promises');
const {promisify} = require('node:util');
const {createGzip, gunzip} = require('node:zlib');
const {samePath} = require('./path-boundary.cjs');
const {createOperationCache} = require('./operation-cache.cjs');
const {publishNewFile} = require('./project-store.cjs');

const maxBytes = 512 * 1024 * 1024;
const compressionMinimum = 256 * 1024;
const expand = promisify(gunzip);

async function readFile(file) {
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || !samePath(await fs.realpath(file),file)) throw Error('대화 원문 경로가 다른 위치를 가리킵니다.');
  if (!stat.isFile() || stat.size > maxBytes) throw Error('대화 원문의 형식과 크기를 확인해 주세요.');
  const handle = await fs.open(file,constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) {
      throw Error('대화 원문이 읽는 중 바뀌었습니다.');
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function readArchive(file) {
  try {
    return await readFile(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // The logical .json reference is stable in all existing session revisions.
  // An earlier plain file becomes the preferred source when both copies exist.
  const packed = await readFile(file + '.gz');
  try {
    return await expand(packed, {maxOutputLength:maxBytes});
  } catch {
    throw Error('압축한 대화 원문의 형식과 크기를 확인해 주세요.');
  }
}

async function alreadySaved(file, expected) {
  let saved;
  try { saved = await readArchive(file); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (createHash('sha256').update(saved).digest('hex') !== expected) throw Error('보관한 대화 원문이 변경됐습니다.');
  return true;
}

async function syncFile(file) {
  const handle = await fs.open(file,'r+');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeArchive(file, data, expected = path.basename(file,'.json')) {
  if (!Buffer.isBuffer(data) || data.length > maxBytes) throw Error('대화 원문의 형식과 크기를 확인해 주세요.');
  if (await alreadySaved(file,expected)) return;
  const cache = await createOperationCache('.flowrium-archive-', path.dirname(file));
  const stage = path.join(cache.directory,'record.tmp');
  try {
    let target = file;
    if (data.length >= compressionMinimum) {
      await pipeline(Readable.from([data]), createGzip({level:3}), createWriteStream(stage,{flags:'wx',mode:0o600}));
      if ((await fs.stat(stage)).size <= data.length * 0.9) target += '.gz';
      else await fs.unlink(stage);
    }
    if (target === file) await fs.writeFile(stage,data,{flag:'wx',mode:0o600});
    await syncFile(stage);
    try { await publishNewFile(stage,target); }
    catch (error) {
      if (error.code !== 'EEXIST' || !await alreadySaved(file,expected)) throw error;
    }
  } finally {
    // Preserve a published archive if the operation has already completed.
    await cache.cleanup().catch(() => {});
  }
}

module.exports = {readArchive, writeArchive};
