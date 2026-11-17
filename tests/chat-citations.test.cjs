const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {Store}=require('../electron/store.cjs');
const {readChatCitation}=require('../electron/chat-citations.cjs');
const {presentCitations}=require('../electron/mobile/file-citations.js');
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

test('PC 입력기와 번들 모바일 입력기가 물결표 및 기존 마크다운 문법을 동일하게 처리한다',async()=>{
  const desktop=await import('../shared/composer-markdown-syntax.mjs');
  const mobile=await import('../electron/mobile/composer-syntax.js');
  for(const input of ['25~35분 / 18~20장', '~ 안녕 ~','~~두 번~~'])
    for(const syntax of [desktop,mobile]) assert.deepEqual(syntax.markdownRanges(input),[]);
  for(const input of ['**강조**','- [x] 할 일','~~~js\nconst sample=true;\n~~~','| A | B |\n| - | - |\n| 1 | 2 |']){
    const ranges=desktop.markdownRanges(input);assert(ranges.length>0);assert.deepEqual(mobile.markdownRanges(input),ranges);
  }
});
