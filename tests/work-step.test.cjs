const test = require('node:test');
const assert = require('node:assert/strict');
const {projectWorkStep, validDetail} = require('../electron/work-step.cjs');
const {activityText, sameWorkActivity} = require('../electron/mobile/work-activity.js');

const createdAt = '2026-11-23T15:20:00.000Z';
const completedAt = '2026-11-23T15:20:01.000Z';
const step = (item, options) => projectWorkStep({id:'fixture', ...item}, {createdAt, completedAt, ...options});

test('검색 결과 없음과 명령 종료를 승인 요청과 다르게 표시한다', () => {
  const empty = step({type:'commandExecution', status:'failed', exitCode:1,
    commandActions:[{type:'search', command:'/opt/bin/rg 숨긴 검색어', path:'/비공개/검증'}]});
  assert.equal(empty.outcome, 'noMatches');
  assert.equal(empty.state, 'completed');
  assert.equal(activityText(empty), '파일 검색 / 검증 / 일치 항목 없음');
  const failed = step({type:'commandExecution', status:'failed', exitCode:2,
    commandActions:[{type:'read', name:'중계 검사.txt', path:'/비공개/중계 검사.txt'}]});
  assert.equal(activityText(failed), '파일 읽기 / 중계 검사.txt / 종료 코드 2');
  assert.equal(activityText({kind:'approval', label:'실행 권한 승인 대기', state:'running'}), '실행 권한 승인 대기');
  const declined=step({type:'commandExecution',status:'declined'});
  assert.equal(activityText(declined), '명령 실행 / 실행하지 않음');
  for(const value of [empty,failed,declined])assert(validDetail(value));
});

test('진행 중과 완료가 같은 항목을 사용하고 공개 요약에서 도구 원문을 보내지 않는다', () => {
  const tool={type:'mcpToolCall', server:'검색 도구', tool:'search', arguments:['숨긴 인증값'], result:{content:['도구 출력']}};
  const pending=step(tool,{running:true});
  const completed=step({...tool,status:'completed'});
  assert.equal(pending.id,completed.id);
  assert.equal(activityText(pending),'연결 도구를 사용하고 있습니다 / 검색 도구 / search');
  assert.equal(activityText(completed),'연결 도구를 사용했습니다 / 검색 도구 / search');
  assert(!JSON.stringify(completed).includes('도구 출력'));
  assert(!JSON.stringify(completed).includes('숨긴 인증값'));
  const web=step({type:'webSearch',action:{type:'openPage',url:'https://example.test/확인?private=hidden'}});
  assert.equal(activityText(web),'웹 페이지를 열었습니다 / example.test');
  assert(sameWorkActivity(completed,{...completed,id:'second'}));
  assert(!sameWorkActivity(pending,completed));
  assert(!sameWorkActivity(completed,{...completed,target:'다른 도구'}));
});
