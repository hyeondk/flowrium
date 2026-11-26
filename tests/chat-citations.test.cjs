const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {randomUUID}=require('node:crypto');
const {Store}=require('../electron/store.cjs');
const {readChatCitation}=require('../electron/chat-citations.cjs');
const {presentCitations}=require('../electron/mobile/file-citations.js');
const {chatFileLinkTarget}=require('../electron/chat-file-links.js');
const source=':codex-file-citation{path="outputs/표지.png" artifactId="report"}';
const document=':codex-file-citation{path="outputs/보고서.pptx" artifactId="report"}';
test('스트리밍 경계, 코드와 인용, 파일별 식별 관계 및 원문 보존',()=>{
  for(let n=1;n<source.length;n++)assert.equal(presentCitations('설명 '+source.slice(0,n),'assistant',true).text,'설명 ');
  const examples=['`'+source+'`','~~~md\n'+source+'\n~~~','> '+source];
  const original='앞 문장\n![표지](outputs/표지.png)'+source+source+document+'\n:codex-file-citation{path="outputs/별도.csv"}\n뒤 문장\n'+examples.join('\n');
  const output=presentCitations(original);
  assert.equal(output.groups.length,2);
  assert.deepEqual(output.groups[0].files.map(f=>f.name),['표지.png','보고서.pptx']);
  assert.equal(output.text,'앞 문장\n\n\n뒤 문장\n'+examples.join('\n'));
  assert.equal(presentCitations(original,'user').text,original);
});
test('답변에 포함된 같은 프로젝트의 실제 산출물만 읽고 원본과 같은 바이트를 반환한다',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-citation-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
  const folder=path.join(root,'project'),outputs=path.join(folder,'outputs');
  await fs.mkdir(outputs,{recursive:true});
  const store=new Store(path.join(root,'profile'));await store.load();
  const project=await store.addProject(folder);
  const message={role:'assistant',id:randomUUID(),text:source+document+':codex-file-citation{path="../private.txt"}',createdAt:new Date().toISOString()};
  const chat=await store.createSession(project.id,{messages:[message]});
  const bytes=Buffer.from('89504e470d0a1a0a','hex');
  await fs.writeFile(path.join(outputs,'표지.png'),bytes);
  const result=await readChatCitation(store,chat.id,message.id,0,'preview');
  assert.equal(result.dataUrl,'data:image/png;base64,'+bytes.toString('base64'));
  await assert.rejects(readChatCitation(store,chat.id,message.id,1,'download'));
  await fs.writeFile(path.join(outputs,'보고서.pptx'),'synthetic-file');
  assert.equal((await readChatCitation(store,chat.id,message.id,1,'download')).name,'보고서.pptx');
  await assert.rejects(readChatCitation(store,chat.id,message.id,2,'download'));
  await assert.rejects(readChatCitation(store,chat.id,randomUUID(),0,'preview'));
});

test('마크다운 파일 링크는 로컬 경로만 디코딩하고 겹친 퍼센트 표현을 그대로 둔다',()=>{
  assert.equal(chatFileLinkTarget('/프로젝트/회의%20록%2520.hwp'),'/프로젝트/회의 록%20.hwp');
  assert.equal(chatFileLinkTarget('file:///C:/프로젝트/회의%20록.pdf'),'C:/프로젝트/회의 록.pdf');
  assert.equal(chatFileLinkTarget('C:%5C프로젝트%5C회의.pdf'),'C:/프로젝트/회의.pdf');
  for(const href of ['#제목','https://example.com/회의.pdf','javascript:alert(1)','file://nas/회의.pdf','//nas/회의.pdf','%5C%5Cnas%5C회의.pdf','outputs/%00회의.pdf']){
    assert.equal(chatFileLinkTarget(href),null,href);
  }
});

test('답변의 절대 파일 링크를 표시하고 상대 경로, 미리보기 및 다운로드는 기존 경계를 지킨다',async t=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-markdown-file-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
  const folder=path.join(root,'프로젝트'),docs=path.join(folder,'회의 자료 (검토)'),external=path.join(root,'다른 폴더');
  await fs.mkdir(docs,{recursive:true});
  await fs.mkdir(external);
  const hwp=path.join(docs,'회의록 최종.hwp'),pdf=path.join(docs,'보고서 %20.pdf'),offsite=path.join(external,'외부.pdf');
  await Promise.all([hwp,pdf,offsite].map(file=>fs.writeFile(file,'fixture')));
  await fs.symlink(external,path.join(folder,'연결'),'junction');
  const store=new Store(path.join(root,'profile'));await store.load();
  const project=await store.addProject(folder);
  const portable=file=>file.split(path.sep).join('/');
  const paths=[portable(hwp),pathToFileURL(pdf).href,portable(offsite),'연결/외부.pdf',
    '회의 자료 (검토)/누락.pdf','../다른 폴더/외부.pdf',portable(path.join(folder,'연결','외부.pdf'))];
  const picked=[];
  const body=paths.map(link=>`[회의 파일](<${link}>)`).join('\n');
  const forged='`[다른 파일](<'+portable(hwp)+'>)`';
  const messages=[{role:'assistant',id:randomUUID(),text:body+'\n:codex-file-citation{path='+JSON.stringify(portable(hwp))+'}',createdAt:new Date().toISOString()},
    {role:'assistant',id:randomUUID(),text:forged,createdAt:new Date().toISOString()},
    {role:'user',id:randomUUID(),text:body,createdAt:new Date().toISOString()}];
  const chat=await store.createSession(project.id,{messages});
  const show=(index,message=messages[0])=>readChatCitation(store,chat.id,message.id,index,'reveal',file=>picked.push(file));
  assert.equal((await show(paths[0])).name,'회의록 최종.hwp');
  assert.equal((await show(paths[1])).name,'보고서 %20.pdf');
  assert.equal((await show(paths[2])).name,'외부.pdf');
  assert.equal((await show(0)).name,'회의록 최종.hwp');
  for(const link of [...paths.slice(3),portable(hwp.replace('.hwp','.xlsx'))])await assert.rejects(show(link));
  await assert.rejects(readChatCitation(store,chat.id,messages[0].id,paths[2],'reveal'));
  await assert.rejects(show(paths[0],messages[1]));
  await assert.rejects(show(paths[0],messages[2]));
  await assert.rejects(readChatCitation(store,chat.id,messages[0].id,paths[1],'download'));
  assert.deepEqual(picked.map(file=>file.normalize('NFC')),[hwp,pdf,offsite,hwp].map(file=>file.normalize('NFC')));
});

test('PC 입력기와 번들 모바일 입력기가 물결표 및 기존 마크다운 문법을 동일하게 처리한다',async()=>{
  const desktop=await import('../shared/composer-markdown-syntax.mjs');
  const mobile=await import('../electron/mobile/composer-syntax.js');
  for(const input of ['25~35분 / 18~20장', '~ 안녕 ~','~~두 번~~'])
    for(const syntax of [desktop,mobile]) assert.deepEqual(syntax.markdownRanges(input),[]);
  for(const input of ['**강조**','- [x] 할 일','~~~js\nconst sample=true;\n~~~','| A | B |\n| - | - |\n| 1 | 2 |']){
    const ranges=desktop.markdownRanges(input);assert(ranges.length>0);assert.deepEqual(mobile.markdownRanges(input),ranges);
  }
});

test('마크다운 입력기에서 구분선의 원래 글자는 숨기지 않는다',async()=>{
  const desktop=await import('../shared/composer-markdown-syntax.mjs');
  const mobile=await import('../electron/mobile/composer-syntax.js');
  const input='**강조**\n====\n\n——\n\n----\n\n_ _ _\n\n* * *\n\n1. 번호 목록';
  for(const syntax of [desktop,mobile]){
    const ranges=syntax.markdownRanges(input);
    assert.deepEqual(ranges.filter(([,style])=>style==='marker').map(([offset])=>offset),[0,4]);
    assert(ranges.some(([,style])=>style==='strong'));
    assert(ranges.some(([,style])=>style==='bullet'));
  }
});
