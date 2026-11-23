const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');
const { openConversation } = require('./shell-test-helpers.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-alignment-')));
  const projectMetrics = [];
  const chatMetrics = [];
  let app;
  try {
    const folder = path.join(temp, '제품 운영');
    const profile = path.join(temp, 'profile');
    await fs.mkdir(folder);
    const store = new Store(profile);
    await store.load();
    const project = await store.addProject(folder);
    const session = await store.createSession(project.id, {
      title: '주간 보고서 초안 검토',
      messages: [{ id: randomUUID(), role: 'user', text: '주간 보고서를 검토해 주세요.', createdAt: new Date().toISOString() }, { id: randomUUID(), role: 'assistant', text: '문의 유형별로 이번 주 대응 내역을 정리했습니다.\n\n- 결제 문의의 답변 초안을 검토합니다.\n- 반복 문의를 다음 주 도움말에 반영합니다.', createdAt: new Date().toISOString() }],
    });
    await store.saveSettings({ codexPath: path.join(__dirname, 'backend-fake-codex.cjs'), theme: 'light' });
    const env = { ...process.env, FLOWRIUM_USER_DATA: profile, CODEX_HOME: path.join(temp, 'codex') };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    app = await _electron.launch({ args: [root], env, timeout: 45000 });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.side-usage[data-connected=true]').waitFor();
    await page.locator('.workspace-side').hover();
    await page.locator('.side-project').getByText(project.name, { exact: true }).click();
    await page.locator('.overview-tools>summary').click();
    const shortcuts = page.locator('.project-shortcuts');
    await shortcuts.waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(10, 5);
    for (const width of [1440, 1024, 800, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const metrics = await shortcuts.evaluate(panel => {
        const rect = node => node.getBoundingClientRect();
        const section = panel.closest('.pf-content');
        const headers = [...section.querySelectorAll('.pf-panel > .pf-section-header:first-child')].filter(node => node.getBoundingClientRect().width);
        const box = rect(panel);
        const summary = rect(panel.querySelector('.pf-empty'));
        const title = rect(panel.querySelector('h2'));
        const manage = rect(panel.querySelector('button'));
        const center = node => node.y + node.height / 2;
        return {
          width: innerWidth, cardHeight: box.height, bottomInset: box.bottom - summary.bottom,
          titleActionOffset: Math.abs(center(title) - center(manage)),
          headerInsets: headers.map(node => rect(node).top - rect(node.parentElement).top),
          pageOverflow: section.scrollWidth - section.clientWidth,
        };
      });
      projectMetrics.push(metrics);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConversation(page, session.title);
    const message = page.locator('.message.assistant').first();
    await page.locator('.message.user .message-time').waitFor();
    const logo=message.locator('.message-avatar img');
    await logo.waitFor();
    assert(await logo.evaluate(async img=>{
      await img.decode();
      const canvas=document.createElement('canvas');
      canvas.width=canvas.height=32;
      const context=canvas.getContext('2d');
      context.drawImage(img,0,0,32,32);
      const pixels=context.getImageData(0,0,32,32).data;
      let blue=0;
      for(let index=0;index<pixels.length;index+=4){
        const [r,g,b,a]=pixels.subarray(index,index+4);
        if(b>105 && b>r+40 && b>g+12 && a>200) blue++;
      }
      return img.naturalWidth===img.naturalHeight && blue>100 && pixels[3]===0;
    }), '투명 배경의 파란색 Dots 아바타가 실제 렌더링됨');
    const like = message.getByRole('button', { name: '좋아요', exact: true });
    await like.waitFor();
    const capture = process.argv.indexOf('--screenshot');
    if (capture >= 0) await page.screenshot({ path: process.argv[capture + 1], animations: 'disabled' });
    for (const width of [1440, 1024, 800, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const metrics = await message.evaluate(row => {
        const rect = selector => row.querySelector(selector).getBoundingClientRect();
        const heading = rect('.message-meta'),bubble=rect('.message-bubble'),avatar=rect('.message-avatar'),name=rect('.message-meta strong');
        const voice = rect('.voice-read button');
        const reaction = rect('.ui-like-button');
        const copy = rect('.copy-message');
        const time = rect('time');
        const center = box => box.y + box.height / 2;
        return {
          width: innerWidth, leftInset: copy.left-bubble.left,
          copyToVoice: voice.x - copy.right, voiceToLike: reaction.x - voice.right,
          rowOffset: Math.abs(center(avatar)-center(name)),
          footerOffset:Math.max(...[voice,reaction,copy].map(box=>Math.abs(center(box)-center(time)))),
          actionsBelow:Math.min(voice.top,reaction.top,copy.top)>=bubble.bottom,
          bubbleRadius:parseFloat(getComputedStyle(row.querySelector('.message-bubble')).borderRadius),
          minTarget: Math.min(voice.height, voice.width, reaction.height, reaction.width, copy.width, copy.height),
          overflow: row.scrollWidth - row.clientWidth,
        };
      });
      chatMetrics.push(metrics);
    }
    await like.click();
    await message.getByRole('button', { name: '좋아요 취소' }).waitFor();
    await page.getByRole('button',{name:'대화 관리',exact:true}).click();
    const management=page.getByRole('dialog',{name:'대화 관리'});
    const titleInput=management.getByLabel('대화 이름',{exact:true});
    for (const width of [320,390,1024]) {
      await page.setViewportSize({width,height:900});
      await titleInput.focus();
      const bounds=await titleInput.evaluate(input=>{
        const group=input.closest('fieldset'),control=input.getBoundingClientRect(),frame=group.getBoundingClientRect();
        const style=getComputedStyle(input);
        return {left:control.left-frame.left,right:frame.right-control.right,width:control.width,outline:parseFloat(style.outlineWidth),offset:parseFloat(style.outlineOffset)};
      });
      assert(bounds.width>100&&bounds.left>=-1&&bounds.right>=-1,`대화 제목 입력이 팝업 안에 표시됨 ${width}`);
      assert(bounds.outline>0&&bounds.offset<0,`대화 제목 포커스 테두리가 안쪽에서 그려짐 ${width}`);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ projectMetrics, chatMetrics }));
    for (const m of projectMetrics) {
      assert(m.headerInsets.every(value => value >= 12 && value <= 21), `제목 위 간격 ${m.width}`);
      assert(m.bottomInset >= 12 && m.bottomInset <= 21, `빈 카드 아래 간격 ${m.width}`);
      assert(m.titleActionOffset <= 1, `카드 제목과 관리 버튼 높이 ${m.width}`);
      assert(m.pageOverflow <= 1, `프로젝트 가로 넘침 ${m.width}`);
    }
    for (const m of chatMetrics) {
      assert(m.leftInset>=0&&m.leftInset<=4, `답변 말풍선 바깥 하단 도구 정렬 ${m.width}`);
      assert(m.copyToVoice >= 0 && m.copyToVoice <= 6 && m.voiceToLike >= 0 && m.voiceToLike <= 6, `도구 간격 ${m.width}`);
      assert(m.rowOffset <= 1 && m.footerOffset <= 1 && m.actionsBelow && m.bubbleRadius>=18 && m.overflow <= 1, `아이콘·Codex 상단 정렬 / 시간·도구 하단 정렬 / 둥근 말풍선 ${m.width}`);
      assert(m.minTarget >= 24, `90% 읽기 배율에서 도구 클릭 영역 ${m.width}`);
    }
  } finally {
    if (app) await app.close();
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
