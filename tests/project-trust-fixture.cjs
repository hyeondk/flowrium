const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const {Store} = require('../electron/store.cjs');
const {samePath} = require('../electron/path-boundary.cjs');

// The test supplies the project it created under its temporary fixture directory.
async function trustFixtureProject(store, project, { account } = {}) {
  const expectedPath = await fs.realpath(project.path);
  if (account) {
    const owner = createHash('sha256').update('flowrium-account:' + account.trim().toLowerCase()).digest('hex');
    store = new Store(path.dirname(store.file), {projectTrustOwner: () => owner});
    await store.load();
  }
  assert.equal(await store.requestProjectTrust(project.id, async target => {
    assert.equal(target.name, project.name);
    assert(samePath(target.path, expectedPath), '승인 대상은 등록한 시험 폴더여야 합니다.');
    return true;
  }), true);
}
const backendFixtureAccount = '개인정보를 출력하지 않음';

async function addTrustedFixtureProject(store, folder, options) {
  const project = await store.addProject(folder);
  await trustFixtureProject(store, project, options);
  return project;
}

async function trustRegisteredFixtureFolder(profile, folder, account = backendFixtureAccount) {
  const store = new Store(profile);
  await store.load();
  const expected = await fs.realpath(folder);
  const project = store.state.projects.find(item => samePath(item.path, expected));
  assert(project, '이미 등록된 시험 프로젝트 폴더');
  return trustFixtureProject(store, project, {account});
}

module.exports = { trustFixtureProject, addTrustedFixtureProject, trustRegisteredFixtureFolder, backendFixtureAccount };
