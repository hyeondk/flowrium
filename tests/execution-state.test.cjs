const {test}=require('node:test'),assert=require('node:assert/strict');
const {sessionExecution,awaitsContinuation,continuationAnswer,visibleProposals,QUESTION_DECISION_NOTICE}=require('../shared/execution-state.ts');
const session=(text='',role='assistant')=>({id:'s',projectId:'p',messages:text?[{role,text}]:[]});
test('작업중 / 대기 / 결정은 실행과 사용자 요청의 우선순위로 구분한다',()=>{
 const s=session('작업을 계속할까요?');
 const activity={source:'local',text:'',status:'실행'};
 assert.equal(sessionExecution(s,activity,[]),'running');
 assert.equal(sessionExecution(s,activity,[{sessionId:'s',type:'input'}]),'decision');
 assert.equal(sessionExecution(s,{source:'external',text:'',status:'실행'},[]),'running');
 assert.equal(sessionExecution(s,{status:'작업 오류',error:'실패',text:''},[]),'waiting');
 assert.equal(sessionExecution(s,null,[]),'waiting');
 assert.equal(sessionExecution(session('완료했습니다.'),null,[]),null);
 assert.equal(sessionExecution(session('계속할까요?','user'),null,[]),null);
 assert.equal(sessionExecution(session(),null,[]),null);
 assert.equal(sessionExecution({...s,workflow:{status:'done'}},null,[]),null);
 assert.equal(sessionExecution({...s,queuedMessages:[{status:'queued'}]},null,[]),null);
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
test('완료한 후속 답변과 추가 지시 대기열을 분리하고 새 결정은 유지한다',()=>{
 const s=session('계속 진행할까요?');
 s.messages[0].id='first';s.completedContinuationId='first';
 assert.equal(sessionExecution(s,null,[]),null);
 assert.equal(sessionExecution({...s,queuedMessages:[{status:'queued'}]},null,[]),null);
 assert.equal(sessionExecution(s,null,[{sessionId:s.id,type:'input'}]),'decision');
 s.messages.push({id:'second',role:'assistant',text:'다음 단계도 진행할까요?'});
 assert.equal(sessionExecution(s,null,[]),'waiting');
});
test('다음 작업 목록과 실제 후속 제안만 대기에 포함하고 작업 중 공개 설명은 건너뛴다',()=>{
 const s=session('오류를 수정했습니다.\n\n**다음 작업**\n- 저장소의 회귀 검사');
 s.messages.push({role:'system',progressCommentary:true,text:'이력 조회를 확인했습니다.'});
 assert.equal(awaitsContinuation(s),true);
 assert.equal(continuationAnswer(s),s.messages[0]);
 assert.equal(awaitsContinuation({...s,compacting:true}),false);
 assert.equal(awaitsContinuation(session('오류를 수정했습니다.\n\n```text\n다음 작업도 계속 진행할까요?\n```')),false);
 assert.equal(awaitsContinuation(session('파일 종류는 무엇으로 선택하시겠습니까?')),false);
 assert.equal(QUESTION_DECISION_NOTICE,'어시스턴트가 질문이 있으니 결정 부탁드립니다.');
});
test('부분 답변 뒤 실패·중단이 있으면 후속 진행 대기로 표시하지 않는다',()=>{
 for(const text of ['작업을 완료하지 못했습니다.','사용자의 요청으로 작업이 중지됐습니다.']){const s=session('계속 진행할까요?');s.messages.push({role:'system',text});assert.equal(awaitsContinuation(s),false);assert.equal(sessionExecution(s,null,[]),null);assert.equal(sessionExecution(s,null,[{sessionId:s.id,type:'approval'}]),'decision');}
});
