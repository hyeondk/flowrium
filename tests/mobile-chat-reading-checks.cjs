const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');

async function addReadingFixture(store,projectId){
  const initial=randomUUID(),second=randomUUID();
  const message=(role,text,turnId)=>({id:randomUUID(),role,text,turnId,createdAt:new Date().toISOString()});
  return store.createSession(projectId,{title:'휴대폰 읽기 확인',messages:[
    message('user','첫 요청',initial),message('system','실행 도구 / 명령\n시험용 출력 원문',initial),
    message('assistant','**진행**',initial),message('system','파일 변경 기록\n시험용 출력 원문',initial),
    message('user','다음 요청',second),message('system','도구 실행 기록\n시험용 출력 원문',second),
    message('assistant','마지막 응답',second),
  ]});
}

async function checkReading(page,chat,origin,key) {
  const url=origin+'/api/mobile/sessions/'+chat.id;
  const read=async suffix=>(await fetch(url+suffix,{headers:{Authorization:'Bearer '+key}})).json();
  const old=await read(''),expanded=await read('?progress=1');
  assert.equal(old.messages.filter(m=>m.role==='system').length,0);
  assert(!JSON.stringify(expanded).includes('시험용 출력 원문'));
  await page.getByRole('button',{name:/휴대폰 읽기 확인/}).click();
  const first=page.getByRole('button',{name:'작업 과정 (2건)',exact:true});
  await first.waitFor();assert.equal(await page.locator('[data-work-group]').count(),2);
  await first.click();
  const popup=page.getByRole('dialog',{name:'작업 과정'});
  assert.deepEqual(await popup.locator('li strong').allTextContents(),['명령 실행','파일 변경']);
  await popup.getByRole('button',{name:'닫기'}).click();
  const user=page.locator('article[data-role=user]').first(),assistant=page.locator('article[data-role=assistant]').first();
  assert((await user.boundingBox()).x>(await assistant.boundingBox()).x+20);
  await assistant.locator('strong').getByText('진행').waitFor();
  const raw='# 미리보기\n\n**강조**와 `코드`\n\n- [x] 확인';
  const input=page.getByRole('textbox',{name:'요청',exact:true});
  await input.fill(raw);
  const preview=page.locator('.mobile-draft-preview');
  await preview.getByRole('heading',{name:'미리보기'}).waitFor();
  assert.equal(await preview.locator('strong').textContent(),'강조');
  assert.equal(await preview.getByRole('checkbox').isChecked(),true);
  assert.equal(await input.inputValue(),raw);
  await page.getByRole('button',{name:'프로젝트로',exact:true}).click();
  // 기존 데스크톱 형식은 추가 필드와 공개 작업 단계를 제공하지 않는다.
  await page.route(url+'?**',route=>route.fulfill({json:old}));
  try{
    await page.getByRole('button',{name:/휴대폰 읽기 확인/}).click();
    await page.getByText('마지막 응답',{exact:true}).waitFor();
    assert.equal(await page.locator('[data-work-group]').count(),0);
    await page.getByRole('button',{name:'프로젝트로',exact:true}).click();
  }finally{await page.unroute(url+'?**');}
}

async function checkDraftImages(page,png) {
  const names=['현장.png',...Array.from({length:7},(_,i)=>'추가'+i+'.png')];
  await page.getByLabel('파일 첨부',{exact:true}).setInputFiles(names.map(name=>({name,mimeType:'image/png',buffer:png})));
  const strip=page.locator('form .mobile-photo-strip');
  await strip.locator('img').nth(7).waitFor({state:'attached'});
  await strip.scrollIntoViewIfNeeded();
  await strip.locator('img[src^="data:image/"]').first().waitFor();
  assert.equal((await strip.innerText()).includes('.png'),false);
  assert(await strip.evaluate(el=>el.scrollWidth>el.clientWidth+20));
  await strip.evaluate(el=>el.scrollLeft=el.scrollWidth);
  assert(await strip.evaluate(el=>el.scrollLeft>20));
  await page.getByRole('button',{name:'추가6.png 첨부 해제'}).click();
  assert.equal(await strip.locator('img').count(),7);
}
module.exports={addReadingFixture,checkReading,checkDraftImages};
