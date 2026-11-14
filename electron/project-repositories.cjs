const { relativePath } = require('./path-boundary.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readDetails } = require('./project-details.cjs');
const { UUID } = require('./project-store.cjs');

async function inside(root, relative = '.') {
  if (typeof relative !== 'string' || relative.length > 1200 || path.isAbsolute(relative) || relative.includes('\\') || /[:\x00-\x1f]/.test(relative) ||
      relative.split('/').some(p => p === '..' || p === '.git' || p === '.flowrium')) throw new Error('프로젝트 안의 폴더 경로를 입력해 주세요.');
  const target = path.resolve(root, relative || '.');
  const real = await fs.realpath(target);
  if (relativePath(target, real) || (relativePath(root, real).startsWith('..') || path.isAbsolute(relativePath(root, real))) || !(await fs.stat(real)).isDirectory())
    throw new Error('프로젝트 안의 실제 폴더만 연결할 수 있습니다.');
  return real;
}
async function detailsFor(store, project) {
  if (!project.id || !UUID.test(project.id)) return {};
  return readDetails(store, project.id);
}
async function resolveRepositoryDirectory(store,project,repo) {
  if(repo.sourceProjectId){
    if(!store.externalRepositoryAccess)throw Object.assign(new Error('이 기기에서 외부 저장소 폴더를 다시 선택해 주세요.'),{code:'EXTERNAL_REPOSITORY_ACCESS',access:'needs-selection'});
    return store.externalRepositoryAccess.resolve(project,repo);
  }
  return inside(await fs.realpath(project.path),repo.path);
}
async function repositoriesFor(store, projectOrId, { includeHidden = false, includeUnavailable = false } = {}) {
  const project = typeof projectOrId === 'string' ? store.project(projectOrId) : projectOrId;
  const details = await detailsFor(store, project);
  const definitions = details.repositories?.length ? details.repositories : [{ id: 'root', name: project.name || '프로젝트', path: '.', github: '', account: '', base: 'main' }];
  const rows=await Promise.all(definitions.filter(r=>includeHidden||!r.hidden).map(async repo=>{
    try{return {...repo,cwd:await resolveRepositoryDirectory(store,project,repo),projectId:project.id,access:repo.sourceProjectId?'authorized':'local'};}
    catch(error){if(!repo.sourceProjectId)throw error;if(!includeUnavailable)return null;return {...repo,projectId:project.id,access:error.access||'unavailable',accessMessage:error.access?error.message:'외부 저장소 폴더를 확인하지 못했습니다. 다시 선택해 주세요.'};}
  }));
  return rows.filter(Boolean);
}
async function repositoryFor(store, projectId, repositoryId) {
  const repos = await repositoriesFor(store, projectId,{includeUnavailable:true});
  const repo = repositoryId ? repos.find(r => r.id === repositoryId) : repos[0];
  if (!repo) throw new Error('연결한 저장소를 선택해 주세요.');
  if(!repo.cwd)throw Object.assign(new Error(repo.accessMessage||'외부 저장소 폴더를 다시 선택해 주세요.'),{code:'EXTERNAL_REPOSITORY_ACCESS',access:repo.access});
  return repo;
}
async function resolveProjectDirectory(store, project) {
  const details = await detailsFor(store, project);
  return inside(await fs.realpath(project.path), details.chatCwd || '.');
}
module.exports = { inside, repositoriesFor, repositoryFor, resolveProjectDirectory, resolveRepositoryDirectory };
