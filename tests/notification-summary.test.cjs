const test = require('node:test');
const assert = require('node:assert/strict');
const {completionSummary} = require('../electron/notification-summary.cjs');

test('완료 알림은 실제 답변의 결과 / 검증 / 남은 사항을 짧게 인용한다', () => {
 const body='## 완료한 내용\n좌측 패널의 간격을 줄였습니다.\n\n## 검증 결과\n자동 검사 411개가 통과했습니다. 설치 앱은 아직 확인하지 않았습니다.\n\n## 반영 위치\n/Users/test/private/app.tsx\n\n## 남은 사항\n실제 설치본의 화면 확인이 남았습니다.';
 const summary=completionSummary(body);
 assert.equal(summary.split('\n').length,3);
 assert.match(summary,/좌측 패널의 간격을 줄였습니다/);
 assert.match(summary,/설치 앱은 아직 확인하지 않았습니다/);
 assert.match(summary,/실제 설치본의 화면 확인이 남았습니다/);
 assert.doesNotMatch(summary,/\/Users\//);
});
test('완료 이벤트만으로 검증 성공이나 남은 작업 없음을 만들어 내지 않는다', () => {
 const summary=completionSummary('자료를 정리했습니다.');
 assert.match(summary,/검증 내용은 대화에서 확인/);
 assert.match(summary,/후속 작업은 대화에서 확인/);
 assert.doesNotMatch(summary,/검증.*(?:통과|성공)|남은 사항.*없/);
});
test('중단과 실패를 이전 답변의 성공 문장으로 표시하지 않는다', () => {
 assert.match(completionSummary('모두 완료했습니다.','failed'),/^결과 \/ 작업을 완료하지 못했습니다/);
 assert.match(completionSummary('모두 완료했습니다.','interrupted'),/^결과 \/ 작업이 중지되었습니다/);
});
test('긴 답변 / 원시 프로토콜 / 로컬 경로는 알림에 그대로 노출하지 않는다', () => {
 const body='<send_user_message_question_reply>{"secret":"raw"}</send_user_message_question_reply>\n:codex-file-citation{path="/Users/private/a.png"}\n'+('아주 긴 설명 '.repeat(1000));
 const summary=completionSummary(body);
 assert.equal(summary.split('\n').length,3);
 assert.ok(summary.length<260);
 assert.doesNotMatch(summary,/secret|codex-file-citation|\/Users\/|send_user_message/);
});
test('긴 문장의 부정 조건을 잘라 성공으로 바꾸지 않는다', () => {
 const summary=completionSummary('## 검증 결과\n'+('여러 환경에서 수행한 검사 '.repeat(8))+'는 통과하지 못했습니다.');
 assert.match(summary,/검증 내용은 대화에서 확인/);
 assert.doesNotMatch(summary,/통과했습니다/);
 const qualified=completionSummary('## 검증 결과\n자동 검사는 통과했습니다. '+('여러 설치 환경에서 필요한 화면 확인 '.repeat(5))+'은 아직 수행하지 못했습니다.');
 assert.match(qualified,/검증 내용은 대화에서 확인/);
 assert.doesNotMatch(qualified,/통과했습니다/);
});

test('완료 알림은 소요 시간 대신 답변에서 70자 이하 미리보기를 만든다',()=>{
 const {completionPreview}=require('../electron/notification-summary.cjs');
 const answer='예상 소요 시간: 3초입니다.\n# 작업 결과\n'+('광고 주문서의 월별 합계와 성과를 비교해 보고서를 정리했습니다. '.repeat(5));
 const result=completionPreview(answer,'completed');
 assert.match(result,/광고 주문서의 월별 합계/);
 assert(Array.from(result).length<=70);
 assert(!result.includes('소요 시간'));
 assert(!completionPreview('/Users/test/별도.txt','completed').includes('/Users/'));
 assert.match(completionPreview(answer,'failed'),/완료하지 못했습니다/);
});
