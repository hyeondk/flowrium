const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const startingVersion = '261115_09';
const nextVersion = '261115_10';

async function productRelease() {
  const mobile = path.join(__dirname, '..', 'electron', 'mobile');
  const files = {};
  for (const name of await fs.readdir(mobile)) {
    if (/\.(html|js|css|webmanifest|svg)$/.test(name) && !name.endsWith('.d.ts')) {
      files[name] = await fs.readFile(path.join(mobile, name), 'utf8');
    }
  }
  // Only the new document has this marker, so a stale page cannot pass a reload check.
  files['index.html'] = files['index.html'].replace('<title>Flowrium</title>',
    '<meta name="update-fixture" content="applied"><title>Flowrium</title>');
  const bytes = Buffer.from(JSON.stringify({format:1,version:nextVersion,files}));
  const name = 'Flowrium-' + nextVersion + '-mobile-v1.json';
  const asset = {name, size:bytes.length, digest:'sha256:' + createHash('sha256').update(bytes).digest('hex'),
    browser_download_url:'https://github.com/hyeondk/flowrium/releases/download/' + nextVersion + '/' + name};
  let state = 'current', downloads = 0;
  return {
    setState(next) { state = next; },
    downloadCount() { return downloads; },
    async fetch(url) {
      if (url === 'https://api.github.com/repos/hyeondk/flowrium/releases/latest') {
        if (state === 'offline') return new Response('unavailable', {status:503});
        return Response.json({draft:false, prerelease:false, tag_name:state === 'current' ? startingVersion : nextVersion,
          assets:state === 'desktop' ? [] : [asset]});
      }
      assert.equal(url, asset.browser_download_url);
      downloads++;
      return new Response(bytes);
    }
  };
}

async function checkMobileUpdate(page, release) {
  const section = page.getByRole('region', {name:'앱 업데이트'});
  const check = section.getByRole('button', {name:'업데이트 확인', exact:true});
  const apply = section.getByRole('button', {name:'업데이트 적용', exact:true});
  const current = page.locator('meta[name="flowrium-mobile-version"]');
  assert.equal(await current.getAttribute('content'), startingVersion);
  assert((await section.innerText()).includes(startingVersion));

  async function manualCheck(state) {
    release.setState(state);
    const completed = page.waitForResponse(r => r.url().endsWith('/api/mobile/call') &&
      r.request().postDataJSON()?.method === 'checkMobileUpdate');
    await check.click();
    return (await completed).json();
  }
  assert.equal((await manualCheck('current')).result.status, 'current');
  assert((await section.innerText()).includes(startingVersion));
  assert.equal(await apply.isVisible(), false);
  assert((await manualCheck('offline')).error);
  assert.equal(await current.getAttribute('content'), startingVersion);
  assert.equal((await manualCheck('desktop')).result.status, 'desktop-required');
  assert.equal(await apply.isVisible(), false);
  assert.equal((await manualCheck('available')).result.status, 'available');
  await apply.waitFor();
  assert.equal(release.downloadCount(), 0);
  assert.equal(await current.getAttribute('content'), startingVersion);

  const navigation = page.waitForEvent('domcontentloaded');
  await apply.click();
  await navigation;
  await page.waitForFunction(version => document.querySelector('meta[name="flowrium-mobile-version"]')?.content === version, nextVersion);
  await check.waitFor();
  assert.equal(await page.locator('meta[name="update-fixture"]').getAttribute('content'), 'applied');
  for(const name of ['composer-parse-worker.js','composer-syntax.js','composer-markdown.js','composer-markdown.css','chat-reader.js','markdown-engine.js','attachment-text.js','file-citations.js','work-time.js','answer-followup.js','project-mode.js']){
    const loaded=await page.request.get(new URL('/'+name,page.url()).href);
    assert.equal(loaded.status(),200);
    assert.deepEqual(await loaded.body(),await fs.readFile(path.join(__dirname,'../electron/mobile',name)));
  }
  assert.equal(await page.locator('#nav [aria-current="page"]').getAttribute('data-view'), 'settings');
  assert.equal(await page.evaluate(() => Boolean(sessionStorage.getItem('flowrium.mobile.key') ||
    localStorage.getItem('flowrium.mobile.rememberedKey'))), true);
  assert.equal(await page.evaluate(() => location.hash), '');
  assert.equal((await manualCheck('available')).result.status, 'current');
  assert.equal(await apply.isVisible(), false);
  assert.equal(release.downloadCount(), 1);
  console.log('모바일 설정의 수동 확인 / 현재 버전 / 연결 오류 뒤 재확인 / 컴퓨터 업데이트 안내 / 모바일 묶음 검증 및 새 문서로 교체 / 설정과 연결 복원 통과');
}

module.exports = {checkMobileUpdate, productRelease, startingVersion};
