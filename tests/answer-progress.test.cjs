const assert = require('node:assert/strict');
const {test} = require('node:test');
const {estimateAnswer,expectedAnswerPercent,observeAnswerWork} = require('../shared/answer-progress.ts');

const now = Date.UTC(2026,10,23);
const request = (id,text,times={}) => ({id,role:'user',text,createdAt:new Date(now).toISOString(),...times});
const reply = (id,turnId) => ({id,role:'assistant',text:'완료했습니다.',turnId,createdAt:new Date(now).toISOString()});
const progress = (estimate,elapsed=3_000,steps=[],streamed) => expectedAnswerPercent(estimate,elapsed,observeAnswerWork(steps),streamed,now);

test('단순 확인과 보통 질문, 실제 작업은 같은 시간이 지나도 진행률이 다르다',()=>{
  const brief=estimateAnswer([request('brief','다시 채팅 테스트')]);
  const reply=estimateAnswer([request('reply','설치 완료 시기는 언제쯤인가요?')]);
  const task=estimateAnswer([request('task','프로젝트의 읽기와 쓰기를 검증해 주세요.')]);
  assert(progress(brief)>progress(reply));
  assert(progress(reply)>progress(task));
  assert.equal(progress(task,0),0);
});

test('같은 종류의 이전 완료 시간을 반영하며 다른 종류와 실패한 요청은 건너뛴다',()=>{
  const started=new Date(now-90_000).toISOString();
  const completed=new Date(now).toISOString();
  const rows=[
    request('small','채팅 확인',{turnId:'a',workStartedAt:started,workCompletedAt:completed}),reply('a','a'),
    request('recorded','검증해 주세요.',{turnId:'b',workStartedAt:started,workCompletedAt:completed}),reply('b','b'),
    request('missing-answer','검증해 주세요.',{turnId:'c',workStartedAt:started,workCompletedAt:new Date(now-26_000).toISOString()}),
    request('current','프로젝트를 검증해 주세요.'),
    request('queued','안녕하세요.'),
  ];
  assert.equal(estimateAnswer(rows,'current').duration,90_000);
  assert.equal(estimateAnswer(rows).size,'brief');
});

test('완료된 도구와 스트리밍을 구분하며 최종 이벤트 전에는 100%에 도달하지 않는다',()=>{
  const task=estimateAnswer([request('task','공식 문서를 비교해 주세요.')]);
  const started={id:'step',state:'running',createdAt:new Date(now-2_000).toISOString()};
  const completed={...started,state:'completed',completedAt:new Date(now-10).toISOString()};
  assert(progress(task,3_000,[completed])>progress(task,3_000,[started]));
  assert(progress(task,1_000,[],1)>progress(task,3_000,[completed]));
  assert(progress(task,1_000,[],325)>progress(task,1_000,[],20));
  assert.equal(progress(task,1_000_000,[],10_000),99.9);
});
