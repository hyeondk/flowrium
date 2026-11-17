const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const { Store } = require('../electron/store.cjs');

async function verifyMobileProjectTrust({page,store,temp,handlers,url}) {
  const name='제품 안내서',other='개인 일정';
  const root=path.join(temp,name),second=path.join(temp,other);
  for(const directory of [root,second])await fs.mkdir(directory);
  const project=await store.addProject(root),sibling=await store.addProject(second);
  const chat=await store.createSession(project.id,{title:'제품 설명 정리',preferences:{sandbox:'read-only'},
    messages:[{id:randomUUID(),role:'assistant',text:'제품 안내문에 들어갈 사용 순서와 구성품 목록을 정리했습니다.',createdAt:new Date().toISOString()}]});
  const oldSend=handlers.get('send'),sent=[],written=[];
  handlers.set('send',async input=>{sent.push(input);return oldSend(input);});
  const listener=request=>{
    if(request.url().endsWith('/api/mobile/call')){
      const body=request.postDataJSON();
      if(['send','startWork','workflowAction'].includes(body.method))written.push(body.method);
    }
  };
  page.on('request',listener);
  const entry=new URL(url),key=new URLSearchParams(entry.hash.slice(1)).get('key');
  const direct=(method,...args)=>fetch(entry.origin+'/api/mobile/call',{method:'POST',
    headers:{Origin:entry.origin,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({method,args})});
  const button=(label)=>page.getByRole('button',{name:label,exact:true});
  const sheet=page.getByRole('alertdialog'),close=sheet.getByRole('button',{name:'닫기',exact:true});
  const dismiss=async()=>{await close.click();await sheet.waitFor({state:'hidden'});};
  const openProject=(label)=>page.getByRole('button',{name:new RegExp(label+'.*업무')}).click();
  try {
    await button('홈').click();
    await openProject(name);await sheet.getByRole('heading',{name:'컴퓨터에서 프로젝트를 신뢰해 주세요'}).waitFor();
    assert((await sheet.innerText()).includes('신뢰하고 편집 허용'));assert(!(await sheet.innerText()).includes(root));
    assert.equal(await sheet.getByRole('button').count(),1);
    if(process.env.FLOWRIUM_MOBILE_TRUST_SCREENSHOT){
      await sheet.evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})));});
      await page.screenshot({path:process.env.FLOWRIUM_MOBILE_TRUST_SCREENSHOT});
    }
    await dismiss();
    await button('새 업무 대화').click();await page.getByLabel('업무 이름').fill('아직 보내지 않은 업무');
    await button('대화 만들기').click();await dismiss();
    assert.equal(await page.getByLabel('업무 이름').inputValue(),'아직 보내지 않은 업무');
    await button('프로젝트로').click();
    await page.getByRole('button',{name:/제품 설명 정리/}).click();
    const draft=page.getByLabel('요청',{exact:true});
    await draft.fill('허용한 폴더에서 안내문을 편집해 주세요.');
    await button('요청 보내기').click();await dismiss();
    assert.equal(sent.length,0);assert.deepEqual(written,[]);
    assert.equal(await draft.inputValue(),'허용한 폴더에서 안내문을 편집해 주세요.');
    for(const [method,input] of [['requestProjectTrust',project.id],['send',{sessionId:chat.id,text:'직접 요청',mode:'build'}],
      ['startWork',{projectId:project.id,kind:'task',title:'직접 생성'}]]){
      assert.equal((await direct(method,input)).status,400,method);
    }
    assert.equal(sent.length,0);
    assert.equal(await store.requestProjectTrust(project.id,async()=>false),false);
    assert.equal(await store.isProjectTrusted(project.id),false);
    let accepted=0;
    assert.equal(await store.requestProjectTrust(project.id,async info=>{accepted++;assert.equal(info.path,await fs.realpath(root));return true;}),true);
    await page.locator('.folder-guide').waitFor({state:'detached'});
    assert.equal(await draft.inputValue(),'허용한 폴더에서 안내문을 편집해 주세요.');
    assert.equal(await store.isProjectTrusted(sibling.id),false);
    if(process.env.FLOWRIUM_MOBILE_TRUST_SCREENSHOT){
      await page.getByText('제품 안내문에 들어갈 사용 순서와 구성품 목록을 정리했습니다.',{exact:true}).waitFor();
      await page.screenshot({path:path.join(path.dirname(process.env.FLOWRIUM_MOBILE_TRUST_SCREENSHOT),'mobile-project-ready.png'),animations:'disabled'});
    }
    require('../electron/chat-attachments.cjs').registerChatAttachments((k,v)=>handlers.set(k,v),store);
    await page.getByLabel('파일 첨부',{exact:true}).setInputFiles({name:'안내문.txt',mimeType:'text/plain',buffer:Buffer.from('합성 자료')});
    const attachment=button('안내문.txt 첨부 해제');await attachment.waitFor();
    // Replacing a previously trusted directory invalidates its permission even
    // when the path in the UI is unchanged. Restoring it recovers the draft.
    const moved=path.join(temp,'보관한 시험 원본');await fs.rename(root,moved);await fs.mkdir(root);
    try{
      await page.locator('.folder-guide').waitFor();
      await button('요청 보내기').click();await dismiss();
      assert.equal(await draft.inputValue(),'허용한 폴더에서 안내문을 편집해 주세요.');
      assert(await attachment.isVisible());assert.deepEqual(written,[]);
    }finally{await fs.rmdir(root);await fs.rename(moved,root);}
    await page.locator('.folder-guide').waitFor({state:'detached'});
    await button('요청 보내기').click();await page.getByText('허용한 폴더에서 안내문을 편집해 주세요.',{exact:true}).waitFor();
    assert.equal(sent.length,1);assert.equal(sent[0].mode,'build');assert.equal(sent[0].sessionId,chat.id);
    assert.equal(sent[0].attachments.length,1);
    assert.deepEqual(written,['send']);
    const restarted=new Store(path.join(temp,'프로필'));await restarted.load();
    assert.equal(await restarted.requestProjectTrust(project.id,async()=>{throw Error('중복 확인');}),true);
    assert.equal(accepted,1);
    assert.equal(await restarted.isProjectTrusted(sibling.id),false);
    await page.reload();await openProject(name);await button('새 업무 대화').click();
    const title=page.getByLabel('업무 이름');await title.fill('새 안내문');await button('대화 만들기').click();
    await page.getByRole('heading',{name:'새 안내문',exact:true}).waitFor();
    await draft.fill('두 번째 문서');await button('요청 보내기').click();
    await page.getByText('두 번째 문서',{exact:true}).waitFor();
    assert.deepEqual(sent.map(x=>x.mode),['build','build']);
    assert.deepEqual(written,['send','startWork','send']);
    await button('홈').click();await openProject(other);await close.waitFor();await dismiss();
    console.log('휴대폰 기존·새 프로젝트 대화 편집 / 최초 신뢰 취소 뒤 초안 보존과 실행 요청 0회 / 컴퓨터 승인 후 각 1회 / 원격 권한 부여 거절 / 재실행과 별도 폴더 격리 통과');
  }finally{
    handlers.set('send',oldSend);page.off('request',listener);
  }
}
module.exports={verifyMobileProjectTrust};
