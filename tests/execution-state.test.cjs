const {test}=require('node:test'),assert=require('node:assert/strict');
const {sessionExecution,awaitsContinuation,visibleProposals}=require('../shared/execution-state.ts');
const session=(text='',role='assistant')=>({id:'s',projectId:'p',messages:text?[{role,text}]:[]});
test('작업중 / 대기 / 결정은 실행과 사용자 요청의 우선순위로 구분한다',()=>{
 const s=session('작업을 계속할까요?');
 assert.equal(sessionExecution(s,{status:'실행'},[]),'running');
 assert.equal(sessionExecution(s,{status:'실행'},[{sessionId:'s',type:'input'}]),'decision');
 assert.equal(sessionExecution(s,null,[]),'waiting');
 assert.equal(sessionExecution(session('완료했습니다.'),null,[]),null);
 assert.equal(sessionExecution(session('계속할까요?','user'),null,[]),null);
 assert.equal(sessionExecution(session(),null,[]),null);
 assert.equal(sessionExecution({...s,workflow:{status:'done'}},null,[]),null);
 assert.equal(sessionExecution({...s,queuedMessages:[{status:'queued'}]},null,[]),'waiting');
});
test('보류 / 숨김 / 처리된 제안은 결정 건수와 대화에서 제외한다',()=>{
 const proposal={status:'pending',sourceId:'s',targetId:'target'};
 assert.equal(sessionExecution(session(),null,[],[proposal]),'decision');
 assert.equal(sessionExecution({...session(),id:'target'},null,[],[proposal]),'decision');
 assert.equal(sessionExecution(session(),null,[],[{...proposal,hidden:true}]),null);
 assert.equal(sessionExecution(session(),null,[],[{...proposal,snoozedUntil:Date.now()+60000}]),null);
 assert.equal(sessionExecution(session(),null,[],[{...proposal,status:'accepted'}]),null);
 assert.equal(visibleProposals([{...proposal,snoozedUntil:100}],101).length,1);
});
