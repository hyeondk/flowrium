const fs = require('node:fs/promises');
const path = require('node:path');
const { readDetails } = require('./project-details.cjs');
const { UUID } = require('./project-store.cjs');

async function inside(root, relative = '.') {
  if (typeof relative !== 'string' || relative.length > 1200 || path.isAbsolute(relative) || relative.includes('\\') || /[:\x00-\x1f]/.test(relative) ||
      relative.split('/').some(p => p === '..' || p === '.git' || p === '.flowrium')) throw new Error('프로젝트 안의 폴더 경로를 입력해 주세요.');
  const target = path.resolve(root, relative || '.');
  const real = await fs.realpath(target);
  if (path.relative(target, real) || (path.relative(root, real).startsWith('..') || path.isAbsolute(path.relative(root, real))) || !(await fs.stat(real)).isDirectory())
    throw new Error('프로젝트 안의 실제 폴더만 연결할 수 있습니다.');
  return real;
}
async function detailsFor(store, project) {
  if (!project.id || !UUID.test(project.id)) return {};
  return readDetails(store, project.id);
}
async function repositoriesFor(store, projectOrId, { includeHidden = false } = {}) {
  const project = typeof projectOrId === 'string' ? store.project(projectOrId) : projectOrId;
  const root = await fs.realpath(project.path);
  const details = await detailsFor(store, project);
  const definitions = details.repositories?.length ? details.repositories : [{ id: 'root', name: project.name || '프로젝트', path: '.', github: '', account: '', base: 'main' }];
  return Promise.all(definitions.filter(r => includeHidden || !r.hidden).map(async repo => ({ ...repo, cwd: await inside(root, repo.path), projectId: project.id })));
}
async function repositoryFor(store, projectId, repositoryId) {
  const repos = await repositoriesFor(store, projectId);
  const repo = repositoryId ? repos.find(r => r.id === repositoryId) : repos[0];
  if (!repo) throw new Error('연결한 저장소를 선택해 주세요.');
  return repo;
}
async function resolveProjectDirectory(store, project) {
  const details = await detailsFor(store, project);
  return inside(await fs.realpath(project.path), details.chatCwd || '.');
}
module.exports = { inside, repositoriesFor, repositoryFor, resolveProjectDirectory };
