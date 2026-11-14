const test=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../src/message-content.ts');
const envelope=()=>({type:'mcpToolCall',state:'completed',result:{content:[{type:'text',text:JSON.stringify({messages:[{role:'assistant',content:':::writing{variant="email"}\n# 중첩된 비공개 본문\n:::'}],access_token:'nested-sensitive-token'})}],structuredContent:null,_meta:null},error:null,durationMs:120,startedAtMs:1000,completedAtMs:1120});
test('작성 서식의 본문을 표시하고 작성 지시문과 정확한 원문을 따로 보존한다',async()=>{
 const {messageContent}=await modulePromise,raw='소개\n\n:::writing{variant="email" id="123" subject="민감 제목"}\n# 안내문\n\n**확인**해 주세요.\n:::\n\n끝';
 const blocks=messageContent(raw,'assistant');assert.deepEqual(blocks.map(b=>b.kind),['markdown','writing','markdown']);assert.equal(blocks[1].text,'# 안내문\n\n**확인**해 주세요.\n');assert(blocks[1].raw.includes('subject="민감 제목"'));assert.equal(blocks.map(b=>b.kind==='markdown'?b.text:b.raw).join(''),raw);
});
test('사용자가 쓴 지시문과 JSON은 임의로 변환하지 않는다',async()=>{
 const {messageContent}=await modulePromise;for(const text of [':::writing{variant="email"}\n본문\n:::',JSON.stringify(envelope()),'```\n:::writing{variant="email"}\n::: 바꾸지 않음\n```'])assert.deepEqual(messageContent(text,'user'),[{kind:'markdown',text}]);
});
test('코드 울타리와 들여쓴 코드 안의 작성 지시문은 그대로 둔다',async()=>{
 const {messageContent}=await modulePromise;
 for(const text of ['```md\n:::writing{variant="email"}\n# 코드의 본문\n:::\n```','~~~~text\n:::writing{variant="email"}\n:::\n~~~~','    :::writing{variant="email"}\n    원본\n    :::'])assert.deepEqual(messageContent(text,'assistant'),[{kind:'markdown',text}]);
 const raw=':::writing{variant="standard"}\n```text\n:::\n```\n본문\n:::';const block=messageContent(raw,'assistant')[0];assert.equal(block.kind,'writing');assert(block.text.includes('```text\n:::\n```'));assert.equal(block.raw,raw);
});
test('중첩 도구 결과는 메시지를 꺼내지 않고 하나의 원본 로그로 분리한다',async()=>{
 const {messageContent}=await modulePromise,raw=JSON.stringify(envelope(),null,2),blocks=messageContent('답변 앞\n\n'+raw+'\n\n답변 뒤','assistant');assert.deepEqual(blocks.map(b=>b.kind),['markdown','log','markdown']);assert.equal(blocks[1].raw,raw+'\n');assert.equal(blocks.filter(b=>b.kind==='writing').length,0);assert(!blocks[0].text.includes('중첩된'));
});
test('일반 JSON의 중첩 tool 모양을 추출하지 않고 완성 JSON 자체를 보존한다',async()=>{
 const {messageContent}=await modulePromise,raw=JSON.stringify({example:envelope(),answer:'**문자 그대로**'},null,2),blocks=messageContent(raw,'assistant');assert.deepEqual(blocks,[{kind:'literal',raw}]);
 assert.deepEqual(messageContent('{"answer":"정상 JSON 답변"}','assistant'),[{kind:'literal',raw:'{"answer":"정상 JSON 답변"}'}]);
});
test('시스템 상태와 실패는 접힘 대상으로 분리하고 불완전한 도구 스트림도 숨긴다',async()=>{
 const {messageContent}=await modulePromise;assert.equal(messageContent('사용자의 요청으로 작업이 중지됐습니다.','system')[0].kind,'log');assert.equal(messageContent('작업을 완료하지 못했습니다. 비공개 상세','system')[0].failed,true);
 const partial='{"type":"mcpToolCall","result":{"content":[';assert.deepEqual(messageContent(partial,'assistant',true),[{kind:'log',raw:partial,pending:true}]);assert.equal(messageContent(partial,'assistant',false)[0].kind,'markdown');
 const writing=':::writing{variant="email"}\n아직 작성 중인 본문';assert.equal(messageContent(writing,'assistant',true)[0].text,'아직 작성 중인 본문');
});
test('확인 가능한 전달 구조만 도구로 분류하며 일반 JSON과 과도한 중첩은 거절한다',async()=>{
 const {isToolResult}=await modulePromise;for(const value of [envelope(),{content:[],isError:false},{contentItems:[],success:true},{type:'function_call_output',call_id:'call-1',output:'결과'},{role:'tool',tool_call_id:'call-1',content:'결과'}])assert.equal(isToolResult(value),true);
 for(const value of [{content:'일반 문서'},{content:[{type:'text',text:'일반 답변'}]},{result:{messages:[]}},{role:'assistant',content:'답변'}])assert.equal(isToolResult(value),false);
 let deep=envelope();for(let i=0;i<1000;i++)deep=[deep];assert.equal(isToolResult(deep),false);
});
test('펼친 요약은 민감키와 중첩 문자열의 인증값을 가리고 길이를 제한한다',async()=>{
 const {safeLogPreview}=await modulePromise,raw=JSON.stringify({...envelope(),authorization:'Bearer direct-sensitive-token',OPENAI_API_KEY:'sk-sensitive-key-1234567890',password:'private-password',link:'https://example.com/#key=connection-secret',large:'긴 자료'.repeat(10000)}),preview=safeLogPreview(raw);
 for(const secret of ['direct-sensitive-token','sk-sensitive-key-1234567890','private-password','nested-sensitive-token','connection-secret'])assert(!preview.includes(secret),secret);assert(preview.includes('[가림]'));assert(preview.length<6100);assert(safeLogPreview('password="공백이 있는 비밀 값" / 결과').includes('[민감값 가림]'));assert(!safeLogPreview('password="공백이 있는 비밀 값" / 결과').includes('비밀 값'));
});
test('직렬화된 도구 JSON도 원문으로만 분리하고 진행 중 작성 메타데이터는 본문에 노출하지 않는다',async()=>{
 const {messageContent}=await modulePromise,raw=JSON.stringify(JSON.stringify(envelope()));assert.equal(messageContent(raw,'assistant')[0].kind,'log');assert.equal(messageContent(raw,'assistant')[0].raw,raw);
 const partial='답변\n\n:::writing{variant="ema';const blocks=messageContent(partial,'assistant',true);assert.deepEqual(blocks.map(b=>b.kind),['markdown','writing']);assert.equal(blocks[1].text,'');assert.equal(blocks[1].raw,':::writing{variant="ema');assert.deepEqual(messageContent(partial,'user',true),[{kind:'markdown',text:partial}]);
});
test('읽기는 작성 지시문 / 도구 원문 / 코드 대신 정상 답변만 전달한다',async()=>{
 const {speakableMessage}=await modulePromise,tool=JSON.stringify(envelope()),raw=':::writing{variant="email" id="숨길 값"}\n# 안내 제목\n\n**확인 사항**을 전달합니다.\n```text\n:::writing{variant="email"}\n코드 원문\n```\n:::\n\n'+tool+'\n\n[안내](https://example.com/?key=숨길연결키)를 읽어 주세요.';
 const spoken=speakableMessage(raw,'assistant');assert(spoken.includes('안내 제목'));assert(spoken.includes('확인 사항을 전달합니다.'));assert(spoken.includes('안내를 읽어 주세요.'));for(const hidden of [':::writing','숨길 값','코드 원문','중첩된 비공개','숨길연결키','nested-sensitive-token','mcpToolCall'])assert(!spoken.includes(hidden),hidden);
 assert.equal(speakableMessage(tool,'assistant'),'');assert.equal(speakableMessage('작업 상태','system'),'');assert.equal(speakableMessage('사용자 원문','user'),'');assert.equal(speakableMessage('{"answer":"일반 JSON"}','assistant'),'');
});
test('대화 목록 미리보기에도 작성 메타데이터나 큰 도구 원문을 넣지 않는다',async()=>{
 const {messagePreview}=await modulePromise;assert.equal(messagePreview(':::writing{variant="email" id="숨길 값"}\n# 안내 제목\n\n정상 본문\n:::','assistant'),'안내 제목 정상 본문');const raw=JSON.stringify(envelope());assert(!messagePreview(raw,'assistant').includes('mcpToolCall'));assert(!messagePreview(raw,'assistant').includes('nested-sensitive-token'));const user='사용자의 :::writing 원문';assert.equal(messagePreview(user,'user'),user);
});
