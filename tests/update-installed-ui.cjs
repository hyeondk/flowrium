// 설치한 앱의 검사/다운로드/종료 코드는 그대로 사용한다. 테스트 릴리스의 HTTPS 응답 본문만 로컬 파일에서 공급한다.
async function bindUpdateTransport(application, fixture) {
  await application.evaluate(({app}, data) => {
    const module = process.getBuiltinModule('node:module');
    const path = process.getBuiltinModule('node:path');
    const fs = process.getBuiltinModule('node:fs');
    const load = module.createRequire(path.join(app.getAppPath(), 'package.json'));
    const {DesktopUpdater} = load('./electron/updater.cjs');
    const original = DesktopUpdater.prototype.check;
    DesktopUpdater.prototype.check = function(...args) {
      this.fetchImpl = async (url) => {
        if (url === 'https://api.github.com/repos/hyeondk/flowrium/releases/latest') return Response.json(data.manifest);
        if (url === data.sumsURL) return new Response(data.sums);
        if (url === data.assetURL) return new Response(fs.createReadStream(data.file));
        throw new Error('예상한 업데이트 주소와 다릅니다.');
      };
      return original.apply(this,args);
    };
  }, fixture);
}
async function clickAvailable(application,version) {
  const page=await application.firstWindow();
  page.setDefaultTimeout(25000);
  const banner=page.locator('.update-banner').filter({hasText:'Flowrium '+version+' 업데이트'});
  if(!await banner.isVisible()) {
    await page.locator('.settings-button').click();
    const settings=page.getByRole('dialog').getByRole('region',{name:'프로그램 업데이트'});
    const check=settings.getByRole('button',{name:'새 버전 확인'});
    if(await check.isVisible()) await check.click();
    await settings.getByRole('button',{name:'업데이트 후 재시작'}).waitFor();
    await page.getByRole('button',{name:'설정 닫기'}).click();
  }
  await banner.getByRole('button',{name:'업데이트 후 재시작'}).click();
  return page;
}
module.exports={bindUpdateTransport,clickAvailable};
