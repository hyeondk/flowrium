const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), qa = path.join(root, '.flowrium-tmp/qa-261115_02');
  await fs.mkdir(qa, { recursive: true });
  const temp = await fs.realpath(await fs.mkdtemp(path.join(qa, 'calendar-workspace-')));
  let app, page;
  const result = { passed: false, widths: [] };
  try {
    const profile = path.join(temp, 'profile'), codex = path.join(temp, 'codex');
    await fs.mkdir(codex);
    const store = new Store(profile); await store.load();
    const projectFolder=path.join(temp,'합성 일정 프로젝트');await fs.mkdir(projectFolder);await store.addProject(projectFolder);
    await store.saveSettings({ codexPath: path.join(__dirname, 'backend-fake-codex.cjs') });
    const env = { ...process.env, FLOWRIUM_USER_DATA: profile, CODEX_HOME: codex };
    delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
    app = await _electron.launch({ args: [root], env, timeout: 45000 });
    page = await app.firstWindow(); page.setDefaultTimeout(18000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await app.evaluate(async ({ ipcMain }, { root, profile }) => {
      const req = process.getBuiltinModule('node:module').createRequire(root + '/package.json');
      const fs = req('node:fs/promises'), assert = req('node:assert/strict'), { Store } = req('./electron/store.cjs');
      const store = new Store(profile); await store.load();
      const directory = profile + '/calendar-provider'; await fs.mkdir(directory);
      globalThis.calendarWrites = []; globalThis.calendarQueries = []; globalThis.calendarEvents = [];globalThis.calendarMailQueries=[];
      const runtime = req('./electron/integrations.cjs').registerIntegrations((name, fn) => {
        ipcMain.removeHandler('flowrium:' + name); ipcMain.handle('flowrium:' + name, (_, ...args) => fn(...args));
      }, store, {
        directory, secretStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() },
        openExternal: async address => {
          const target = new URL(address);
          if (target.hostname !== 'accounts.google.com') return;
          assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
          const callback = new URL(target.searchParams.get('redirect_uri'));
          assert.equal(callback.hostname, '127.0.0.1');
          callback.searchParams.set('state', target.searchParams.get('state')); callback.searchParams.set('code', 'calendar-code');
          const response = await fetch(callback); assert.equal(response.status, 200);
        },
        fetchImpl: async (address, options = {}) => {
          const url = new URL(address);
          if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'synthetic-token', refresh_token: 'synthetic-refresh', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.readonly' });
          if (url.hostname === 'openidconnect.googleapis.com') return Response.json({ email: 'calendar@example.test' });
          if(url.hostname==='gmail.googleapis.com'){
            if(url.pathname.endsWith('/messages')){globalThis.calendarMailQueries.push(url.searchParams.get('q'));return Response.json({messages:Array.from({length:7},(_,index)=>({id:'summary-mail-'+index}))});}
            const id=url.pathname.split('/').at(-1);return Response.json({id,internalDate:String(Date.now()),snippet:'미리 보는 합성 메일',payload:{mimeType:'text/plain',headers:[{name:'Subject',value:'미확인 합성 안내 '+id},{name:'From',value:'sender@example.test'},{name:'To',value:'reader@example.test'}],body:{data:Buffer.from('직접 선택해 읽은 합성 메일 본문').toString('base64url')}}});
          }
          if (url.pathname.includes('calendarList')) return Response.json({ items: [{ id: 'primary-calendar', summary: '합성 업무 캘린더', primary: true, accessRole: 'owner' }, { id: 'shared-calendar', summary: '합성 읽기 전용 캘린더', accessRole: 'reader' }] });
          if (!url.pathname.includes('/calendar/v3/calendars/')) throw Error('시험에서 허용하지 않은 외부 요청');
          const id = /\/events\/([^/]+)$/.exec(url.pathname)?.[1];
          if (options.method) {
            globalThis.calendarWrites.push({ method: options.method, headers: options.headers });
            if (options.method === 'DELETE') { globalThis.calendarEvents = globalThis.calendarEvents.filter(event => event.id !== id); return new Response(null, { status: 204 }); }
            const event = { ...JSON.parse(options.body), id: id || 'created-event', etag: '"calendar-revision-' + globalThis.calendarWrites.length + '"' };
            globalThis.calendarEvents = [...globalThis.calendarEvents.filter(value => value.id !== event.id), event];
            return Response.json(event);
          }
          if (id) return Response.json(globalThis.calendarEvents.find(event => event.id === id));
          globalThis.calendarQueries.push({ from: url.searchParams.get('timeMin'), to: url.searchParams.get('timeMax'), query: url.searchParams.get('q') });
          const from = Date.parse(url.searchParams.get('timeMin')), to = Date.parse(url.searchParams.get('timeMax')), query = url.searchParams.get('q') || '';
          return Response.json({ items: globalThis.calendarEvents.filter(event => { const start = Date.parse(event.start.dateTime || event.start.date); return start >= from && start < to && (!query || event.summary.includes(query)); }) });
        },
      });
      globalThis.calendarRuntime = runtime;
    }, { root, profile });
    await page.locator('.workspace-side').hover();
    await page.getByRole('button', { name: '일정', exact: true }).first().click();
    const workspace = page.getByRole('region', { name: 'Google 일정 작업 공간' });
    await workspace.getByText('처음 연결하기', { exact: true }).waitFor();
    assert((await workspace.innerText()).includes('공용 Google 로그인 설정이 없습니다'));
    assert.equal(await app.evaluate(()=>globalThis.calendarQueries.length),0,'연결 전에는 외부 일정을 읽지 않습니다.');
    await workspace.getByLabel('Google 클라이언트 ID', { exact: true }).fill('synthetic.apps.googleusercontent.com');
    await workspace.getByLabel('Google 클라이언트 보안 비밀', { exact: true }).fill('synthetic-secret');
    await workspace.getByRole('button', { name: '연결 정보 저장', exact: true }).click();
    await workspace.getByRole('button', { name: 'Google 계정으로 로그인', exact: true }).click();
    await workspace.getByText('Google 계정 연결됨', { exact: true }).waitFor();
    await workspace.getByLabel('작업할 Google 캘린더', { exact: true }).selectOption('primary-calendar');
    await workspace.getByLabel('조회할 월', { exact: true }).fill('2028-02');
    await workspace.getByRole('button', { name: '2028-02-29 일정 없음', exact: true }).waitFor();
    await workspace.getByRole('button', { name: '목록', exact: true }).click();
    await workspace.getByRole('heading', { name: '2028-02 전체 일정', exact: true }).waitFor();
    await workspace.getByRole('button', { name: '새 일정', exact: true }).click();
    await workspace.getByLabel('일정 제목', { exact: true }).fill('합성 새 일정');
    await workspace.getByLabel('시작', { exact: true }).fill('2028-02-10T09:00');
    await workspace.getByLabel('종료', { exact: true }).fill('2028-02-10T10:00');
    await workspace.getByLabel('설명', { exact: true }).fill('검토할 합성 일정 내용');
    await workspace.getByRole('button', { name: '변경할 일정 검토', exact: true }).click();
    await workspace.getByRole('region', { name: '일정 변경 검토' }).waitFor();
    assert.equal(await app.evaluate(() => globalThis.calendarWrites.length), 0);
    await workspace.getByRole('button', { name: '확인하고 일정 등록', exact: true }).click();
    await workspace.getByRole('status').filter({ hasText: '일정을 등록했습니다.' }).waitFor();
    const createdEvent=workspace.locator('.gcw-event').filter({hasText:'합성 새 일정'});
    await createdEvent.scrollIntoViewIfNeeded();
    result.eventLayout=await createdEvent.evaluate(button=>{
      const rect=button.getBoundingClientRect(),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2),root=document.querySelector('.google-calendar-workspace');
      return {width:rect.width,height:rect.height,hitIsEvent:hit===button||button.contains(hit),workspaceWidth:root.clientWidth,workspaceScroll:root.scrollTop,mainScroll:document.querySelector('.main-shell').scrollTop,windowScroll:scrollY};
    });
    assert(result.eventLayout.width>200);assert.equal(result.eventLayout.hitIsEvent,true);assert.equal(result.eventLayout.mainScroll,0);assert.equal(result.eventLayout.windowScroll,0);
    await createdEvent.click();
    result.settledLayout=[];
    for(const delay of [32,450]){await page.waitForTimeout(delay);result.settledLayout.push(await page.evaluate(()=>({main:document.querySelector('.main-shell').scrollTop,window:scrollY})));}
    assert(result.settledLayout.every(frame=>frame.main===0&&frame.window===0));
    await workspace.getByRole('button', { name: '이 일정 수정 / 삭제', exact: true }).click();
    await workspace.getByLabel('일정 제목', { exact: true }).fill('합성 수정 일정');
    await workspace.getByRole('button', { name: '변경할 일정 검토', exact: true }).click();
    assert.equal(await app.evaluate(() => globalThis.calendarWrites.length), 1);
    await workspace.getByRole('button', { name: '확인하고 일정 수정', exact: true }).click();
    await workspace.locator('.gcw-event').filter({ hasText: '합성 수정 일정' }).click();
    await workspace.getByRole('button', { name: '이 일정 수정 / 삭제', exact: true }).click();
    await workspace.getByLabel('일정 작업', { exact: true }).selectOption('delete');
    await workspace.getByRole('button', { name: '변경할 일정 검토', exact: true }).click();
    await workspace.getByRole('button', { name: '취소', exact: true }).click();
    assert.equal(await app.evaluate(() => globalThis.calendarWrites.length), 2);
    await workspace.getByRole('button', { name: '변경할 일정 검토', exact: true }).click();
    await workspace.getByRole('button', { name: '확인하고 일정 삭제', exact: true }).click();
    await workspace.getByRole('status').filter({ hasText: '일정을 삭제했습니다.' }).waitFor();
    assert.equal(await app.evaluate(() => globalThis.calendarWrites.length), 3);
    await workspace.getByLabel('작업할 Google 캘린더', { exact: true }).selectOption('shared-calendar');
    assert.equal(await workspace.getByRole('button', { name: '새 일정', exact: true }).isDisabled(), true);
    await app.evaluate(()=>{const now=new Date(),next=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1),day=value=>[value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-');globalThis.calendarEvents=[{id:'today-summary',summary:'합성 오늘 일정',start:{date:day(now)},end:{date:day(next)},etag:'"summary-revision"'}];});
    await page.getByRole('button',{name:'대시보드',exact:true}).first().click();
    const summary=page.getByRole('region',{name:'오늘 일정과 미확인 메일'});
    await summary.getByText('합성 오늘 일정',{exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('[aria-label="미확인 메일 요약"] li').length===5);
    assert.equal(await summary.getByRole('article',{name:'미확인 메일 요약'}).locator('li').count(),5);
    assert((await app.evaluate(()=>globalThis.calendarMailQueries)).every(query=>query==='is:unread'));
    await summary.getByRole('article',{name:'미확인 메일 요약'}).locator('li button').first().click();
    const mail=page.getByRole('dialog',{name:'받은 메일 본문'});await mail.getByText('직접 선택해 읽은 합성 메일 본문',{exact:true}).waitFor();
    await mail.getByRole('button',{name:'메일 본문 닫기',exact:true}).click();
    assert.equal(await app.evaluate(()=>globalThis.calendarWrites.length),3,'요약과 메일 본문 조회는 외부 변경을 하지 않습니다.');
    await summary.getByRole('button',{name:'일정 열기',exact:true}).click();
    await workspace.getByRole('heading',{name:'Google 캘린더',exact:true}).waitFor();
    for (const width of [1440, 800, 390, 320]) {
      await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(150);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, '일정 화면 가로 넘침 / ' + width);
      const broken = await workspace.evaluate(root => [...root.querySelectorAll('p, label, button')].filter(element => element.clientWidth && getComputedStyle(element).wordBreak === 'break-all').length);
      assert.equal(broken, 0); result.widths.push(width);
    }
    assert.deepEqual(errors, []);
    result.passed = true;
    console.log('일정 전용 화면 / 공용 로그인 미준비 안내 / 모의 첫 OAuth와 캘린더 / 윤년 월간 / 목록 / 검토 후 등록·수정·삭제·취소 / 읽기 전용 / 네 화면 폭 통과');
  } catch(error) {
    if(page){
      result.failure=await page.evaluate(()=>{
        const event=document.querySelector('.gcw-event');if(!event)return {missingEvent:true};
        const r=event.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        const rows=[];for(let node=event;node;node=node.parentElement){const b=node.getBoundingClientRect(),s=getComputedStyle(node);rows.push({tag:node.tagName,class:node.className,rect:{x:b.x,y:b.y,width:b.width,height:b.height},overflow:s.overflow,overflowY:s.overflowY,position:s.position,transform:s.transform,contain:s.contain,pointerEvents:s.pointerEvents,scrollTop:node.scrollTop,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight});}
        return {viewport:{width:innerWidth,height:innerHeight},hit:hit?.tagName+'.'+hit?.className,rows};
      }).catch(()=>({}));
      await page.screenshot({path:path.join(qa,'google-calendar-workspace-failure.png')}).catch(()=>{});
    }
    throw error;
  } finally {
    await fs.writeFile(path.join(qa, 'google-calendar-workspace-result.json'), JSON.stringify(result, null, 2));
    if (app) { await app.evaluate(() => globalThis.calendarRuntime?.shutdown()).catch(() => {}); await app.close().catch(() => {}); }
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
