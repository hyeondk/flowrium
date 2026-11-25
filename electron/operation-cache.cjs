const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {samePath} = require('./path-boundary.cjs');

async function createOperationCache(name, parent = os.tmpdir()) {
  if (!/^\.?flowrium-[a-z-]+-$/.test(name)) throw Error('작업 임시 폴더 이름을 확인해 주세요.');
  const root = await fs.realpath(parent);
  const directory = await fs.mkdtemp(path.join(root, name));
  const owner = await fs.lstat(directory);
  let cleaning;
  const cleanup = () => cleaning ??= (async () => {
    const found = await fs.lstat(directory).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (!found) return;
    if (!found.isDirectory() || found.isSymbolicLink() || found.dev !== owner.dev || found.ino !== owner.ino ||
      !samePath(directory, await fs.realpath(directory))) {
      throw Error('작업 임시 폴더가 다른 위치로 바뀌어 정리를 중단했습니다.');
    }
    await fs.rm(directory, {recursive:true, force:true, maxRetries:4, retryDelay:100});
  })().catch(error => {
    cleaning = undefined;
    throw error;
  });
  return {directory, cleanup};
}

module.exports = {createOperationCache};
