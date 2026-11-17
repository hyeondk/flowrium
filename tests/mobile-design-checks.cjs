const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

async function checkDesign(app,page,store,folder) {
  const projectDir=path.join(folder,'도시 산책 안내서');
  await fs.mkdir(path.join(projectDir,'docs'),{recursive:true});
  const map=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=560;c.height=185;const ctx=c.getContext('2d');
    ctx.fillStyle='#e8eff4';ctx.fillRect(0,0,560,185);
    ctx.fillStyle='#cbded2';ctx.beginPath();ctx.roundRect(345,26,200,125,38);ctx.fill();
    ctx.strokeStyle='#fff';ctx.lineWidth=15;for(let i=0;i<4;i++){ctx.beginPath();ctx.moveTo(i*112,-10);ctx.lineTo(i*112+58,200);ctx.stroke();}
    ctx.strokeStyle='#6696b5';ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';
    ctx.beginPath();ctx.moveTo(60,133);ctx.lineTo(148,120);ctx.lineTo(189,70);ctx.lineTo(327,75);ctx.lineTo(403,57);ctx.stroke();
    for(const [x,y,name] of [[60,133,'중앙역'],[189,70,'서점'],[403,57,'도시숲 공원']]){
      ctx.fillStyle='#275f86';ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();
      ctx.font='700 18px NanumSquareRound';ctx.fillStyle='#234156';ctx.fillText(name,x+12,y+4);
    }
    return c.toDataURL().split(',')[1];
  });
  const name='산책 안내도.png';await fs.writeFile(path.join(projectDir,'docs',name),Buffer.from(map,'base64'));
  const project=await store.addProject(projectDir),turnId=randomUUID(),now=Date.now(),at=new Date(now).toISOString();
  await require('./project-trust-fixture.cjs').trustFixtureProject(store,project);
  const chat=await store.createSession(project.id,{title:'중앙역에서 도시숲 공원까지',messages:[
    {id:randomUUID(),turnId,role:'user',text:'중앙역에서 공원까지 걷는 길을 정리해줘.',createdAt:at,workStartedAt:new Date(now-206000).toISOString(),workCompletedAt:at},
    {id:randomUUID(),turnId,role:'system',progressCommentary:true,text:'현장 메모에서 갈림길을 확인했어요.',createdAt:at},
    {id:randomUUID(),turnId,role:'assistant',text:'중앙역에서 서점을 지나 도시숲 공원에 도착하는 코스예요. 갈림길과 도착 지점을 안내도에 표시했어요.\n\n:codex-file-citation{path="docs/산책 안내도.png"} :codex-file-citation{path="docs/산책 안내도.png"}\n\n**다음 단계**\n- 산책 코스의 주의사항을 한 쪽으로 정리',createdAt:at}
  ]});
  const refresh=()=>page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.getByRole('navigation').getByRole('button',{name:'홈',exact:true}).click();await refresh();
  await page.getByRole('button',{name:/도시 산책 안내서.*업무/}).click();
  const selected=page.getByRole('button',{name:/중앙역에서 도시숲 공원까지/});await selected.click();
  const image=page.locator('.citation-preview img'),preview=page.getByRole('button',{name:name+' 확대'});
  await image.waitFor();await page.waitForFunction(()=>document.querySelector('.citation-preview img')?.naturalWidth===560);
  assert.equal(await page.locator('.mobile-citation').count(),1);
  assert.equal(await page.locator('article').getByText(/:codex-file-citation/).count(),0);
  const output=path.join(folder,'받은 안내도.png');
  await app.evaluate(({session},destination)=>{session.defaultSession.once('will-download',(_e,item)=>item.setSavePath(destination));},output);
  await page.getByRole('button',{name:name+' 내려받기'}).click();
  let bytes;for(let i=0;i<100;i++){bytes=await fs.readFile(output).catch(()=>null);if(bytes?.length)break;await page.waitForTimeout(45);}
  assert.deepEqual(bytes,Buffer.from(map,'base64'));
  await preview.click();await page.getByRole('dialog',{name:name+' 확대'}).getByRole('button',{name:'닫기'}).click();
  const summary=page.getByRole('button',{name:'3분 26초 동안 작업'});await summary.click();
  await page.getByRole('list',{name:'작업 과정'}).getByText('현장 메모에서 갈림길을 확인했어요.').waitFor();
  await summary.click();assert.equal(await summary.getAttribute('aria-expanded'),'false');
  const field=page.getByRole('textbox',{name:'요청',exact:true}),candidate=page.locator('button.mobile-followup');
  await candidate.waitFor();const prior=await field.inputValue();
  const fontSession=await page.context().newCDPSession(page);await fontSession.send('DOM.enable');await fontSession.send('CSS.enable');
  const root=(await fontSession.send('DOM.getDocument')).root.nodeId;
  try{
    await page.evaluate(()=>document.fonts.ready);
    for(const selector of ['.mobile-chat-heading h1','.mobile-markdown p','.mobile-followup span','.mobile-followup kbd','#nav span']){
      const {nodeId}=await fontSession.send('DOM.querySelector',{nodeId:root,selector});
      const {fonts}=await fontSession.send('CSS.getPlatformFontsForNode',{nodeId});
      assert(fonts.some(font=>font.isCustomFont && /NanumSquareRound/i.test(font.familyName)),selector+' / '+JSON.stringify(fonts));
    }
  }finally{await fontSession.detach();}
  const ratios=[];
  for(const [w,h] of [[320,705],[390,844],[430,900],[844,390]]){
    await page.setViewportSize({width:w,height:h});await page.evaluate(()=>scrollTo(0,0));
    const metrics=await page.evaluate(()=>{
      const el=document.querySelector('.mobile-timeline'),photo=el.querySelector('.citation-preview img');
      const box=()=>{const r=photo.getBoundingClientRect();return [r.width,r.height];};
      const original=el.style.zoom,at90=box();el.style.zoom='1';const at100=box();el.style.zoom=original;
      return {ratio:at90.map((v,i)=>v/at100[i]),width:innerWidth,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        head:document.querySelector('.mobile-chat-heading').getBoundingClientRect().height};
    });
    assert.equal(metrics.overflow,0);assert(metrics.ratio.every(n=>Math.abs(n-.90)<.02),JSON.stringify(metrics));assert(metrics.head>=39 && metrics.head<=46);ratios.push(metrics);
  }
  await page.setViewportSize({width:390,height:844});
  const keyboard=await page.evaluate(async()=>{
    const input=document.querySelector('.chat-compose textarea'),send=document.querySelector('.chat-compose button[type=submit]'),v=visualViewport;
    input.focus({preventScroll:true});scrollTo(0,0);const before=scrollY,height=v.height;
    const next=()=>new Promise(requestAnimationFrame);
    try{
      Object.defineProperty(v,'height',{configurable:true,value:Math.round(height*.52)});
      v.dispatchEvent(new Event('resize'));await next();
      const visible={last:send.getBoundingClientRect().bottom,top:input.getBoundingClientRect().top,height:v.height,nav:getComputedStyle(document.querySelector('#nav')).display};
      delete v.height;v.dispatchEvent(new Event('resize'));await next();await next();
      return {before,after:scrollY,...visible};
    }finally{delete v.height;v.dispatchEvent(new Event('resize'));input.blur();}
  });
  assert(keyboard.last<=keyboard.height+1 && keyboard.top>=0 && keyboard.nav==='none',JSON.stringify(keyboard));
  assert(Math.abs(keyboard.before-keyboard.after)<=1,JSON.stringify(keyboard));
  const colors=[];
  for(const theme of ['dark','light']){
    for(const accentColor of ['purple','green','blue']){
      await store.saveSettings({theme,accentColor});await refresh();
      await page.waitForFunction(v=>document.documentElement.dataset.theme===v[0]&&document.documentElement.dataset.accent===v[1],[theme,accentColor]);
      const contrast=await page.evaluate(()=>{
        const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
        function lum(s){ctx.fillStyle=s;ctx.fillRect(0,0,1,1);const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
        const ratio=(a,b)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        const action=getComputedStyle(document.querySelector('.chat-compose .main-action')),small=getComputedStyle(document.querySelector('.chat-context'));
        return [ratio(lum(action.color),lum(action.backgroundColor)),ratio(lum(small.color),lum(getComputedStyle(document.body).backgroundColor))];
      });
      colors.push({theme,accentColor,contrast});assert(contrast.every(x=>x>=4.5),JSON.stringify(colors.at(-1)));
    }
  }
  assert.equal(await field.inputValue(),prior);
  await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});
  if(process.env.FLOWRIUM_MOBILE_CHAT_SCREENSHOT)await page.screenshot({path:process.env.FLOWRIUM_MOBILE_CHAT_SCREENSHOT,animations:'disabled'});
  await fs.unlink(path.join(projectDir,'docs',name));
  await page.getByRole('button',{name:name+' 내려받기'}).click();
  await page.locator('.mobile-citation').getByRole('status').getByText(/파일을 열 수 없습니다/).waitFor();
  assert.equal(await page.locator('.mobile-citation [role=status]').count(),1);
  assert.equal(await preview.count(),0);
  await page.goBack();await selected.waitFor();await page.goBack();await page.getByRole('heading',{name:'오늘 할 일'}).waitFor();
  console.log('모바일 인라인 파일 중복 제거, 확대·다운로드, 브라우저 뒤로, 실제 나눔스퀘어라운드, 크기·대비 '+JSON.stringify({ratios,colors,keyboard}));
}
module.exports={checkDesign};
