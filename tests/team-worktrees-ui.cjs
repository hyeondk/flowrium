const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');

const exec = promisify(execFile);
async function main() {
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-tree-screen-')));
  const project = path.join(temporary, '화면 검증'), profile = path.join(temporary, 'profile');
  const store = new Store(profile);
  let app;
  try {
    await fs.mkdir(project);
    const git = async (...args) => (await exec('git', ['-C', project, ...args], { windowsHide: true })).stdout.trim();
    await git('init', '-b', 'main');
    await git('config', 'user.email', 'team@example.invalid');
    await git('config', 'user.name', '팀 검증');
    await fs.writeFile(path.join(project, 'common.txt'), 'original\n');
    await fs.writeFile(path.join(project, '.gitignore'), '.flowrium/\n');
    await git('add', '.'); await git('commit', '-m', '기준');
    const original = await git('rev-parse', 'HEAD');
    await store.load(); await store.addProject(project);
    await store.saveSettings({ codexPath: path.join(__dirname, 'backend-fake-codex.cjs') });
    const env = {...process.env, FLOWRIUM_USER_DATA: profile, CODEX_HOME: path.join(temporary, 'codex')};
    delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
    const launch = async () => {
      app = await _electron.launch({ args: [path.resolve(__dirname, '..')], env, timeout: 45000 });
      const page = await app.firstWindow();
      await page.setViewportSize({width:1440,height:1000});
      page.setDefaultTimeout(20000);
      await page.locator('.side-account i[data-connected=true]').waitFor();
      await page.locator('.workspace-side').hover();
      await page.locator('.workspace-side').getByRole('button',{name:'화면 검증',exact:true}).click();
      await page.getByRole('navigation',{name:'프로젝트 상세 탭'}).getByRole('button',{name:'팀',exact:true}).click();
      return page;
    };
    let page = await launch();
    const click = (name) => page.getByRole('button', {name,exact:true}).click();
    const panel = () => page.getByRole('region', {name:'격리 작업 폴더'});
    const treeClick = (name) => panel().getByRole('button', {name,exact:true}).click();
    const change = async (name) => {
      await treeClick(name);
      await treeClick('확인하고 실행');
    };
    const notice = (value) => panel().getByRole('status').filter({hasText:value}).waitFor();
    await click('팀 만들기');
    await page.getByLabel('팀 이름').fill('구현 팀');
    for (const [i,name] of ['첫째','둘째'].entries()) {
      await page.getByLabel('역할 이름').nth(i).fill(name);
      await page.getByLabel('실행 모드').nth(i).selectOption('build');
    }
    await click('팀 저장');
    await page.getByText('참고 자료와 실행 설정', {exact:true}).click();
    await page.getByLabel('역할별 Git 작업 폴더 사용').check();
    await page.getByLabel('공동 요청').fill('독립 폴더에서 같은 파일 편집');
    await click('배정안 만들기');
    for (const [i,name] of ['첫째','둘째'].entries()) {
      await page.getByLabel(name+'에게 배정').check();
      await page.getByLabel('담당 과업').nth(i).fill(name+' 작업');
    }
    await click('선택한 담당자 실행');
    await page.getByRole('heading',{name:'결과 검토',exact:true}).waitFor();
    await panel().waitFor();
    for (const name of ['첫째','둘째']) {
      await treeClick(name);
      const dir = (await panel().locator('.tree-path').innerText()).split(' / ')[1];
      assert.ok(dir && !path.relative(profile,dir).startsWith('..'), '격리된 프로필 작업 폴더');
      await fs.writeFile(path.join(dir, 'common.txt'), name+'의 변경\n');
      await treeClick('변경 새로고침');
      const check = panel().getByRole('checkbox', {name:/common\.txt/});
      await check.check(); await treeClick('차이');
      assert.match(await panel().getByLabel('변경 내용').innerText(),new RegExp(name+'의 변경'));
      await panel().getByLabel('커밋 제목').fill(name+' 검증');
      await treeClick('선택 파일 커밋'); await notice('선택한 파일을 커밋');
      await treeClick('검토한 커밋 통합');
      assert.match(await panel().getByLabel('변경 내용').innerText(),new RegExp(name+'의 변경'));
      await treeClick('확인하고 실행'); await notice(name==='첫째'?'병합했습니다':'충돌을 보존');
    }
    await treeClick('통합'); await panel().getByRole('heading',{name:'병합 충돌'}).waitFor();
    await change('역할본 선택'); await notice('충돌 해결을 기록');
    await change('충돌 해결 후 통합 완료'); await notice('통합 커밋을 만들었습니다');
    const integration = (await panel().locator('.tree-path').innerText()).split(' / ')[1];
    assert.equal((await fs.readFile(path.join(integration,'common.txt'),'utf8')).trim(),'둘째의 변경');
    assert.equal(await git('rev-parse','HEAD'),original);
    await treeClick('둘째'); await change('로컬 작업 폴더와 브랜치 정리');
    await panel().getByRole('button',{name:'보존된 커밋에서 다시 열기'}).waitFor();
    await app.close(); app = undefined;
    page = await launch();
    await page.locator('.team-entry').filter({hasText:'독립 폴더에서 같은 파일 편집'}).click();
    await treeClick('둘째'); await treeClick('보존된 커밋에서 다시 열기');
    await notice('작업 폴더를 열었습니다');
    await treeClick('기준과 커밋 차이 보기');
    assert.match(await panel().getByLabel('변경 내용').innerText(),/둘째의 변경/);
    console.log('실제 팀 화면 / 독립 폴더 2개 / 변경 검토 / 선택 커밋 / 통합 충돌과 해결 / 재시작 후 복원 통과');
  } finally {
    try { if (app) await app.close(); }
    finally { await fs.rm(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:200}); }
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
