import {attachmentDisplayText} from './attachment-text.js';

// Recommendations only use published conversation text, on this device.
const decline = /(?:추천|제안|후속(?:\s*작업)?|다음\s*(?:단계|작업)|추가\s*질문)[^.!?\n]{0,24}(?:하지\s*마|지\s*말|없이|빼|생략|금지|필요\s*없|원하지\s*않)|(?:do not|don't|no)\s+(?:suggest|recommend|follow[ -]?up)/i;
const stoppedText = /^(?:작업을 완료하지 못했습니다\.|사용자의 요청으로 작업이 중지됐습니다\.)/;
const sectionHeading = /^(?:다음\s*(?:(?:권장|우선)\s*)?(?:작업|단계)|(?:권장\s*)?후속\s*작업|남은\s*(?:작업|사항|검증)|next steps?)\s*(?:[:：]\s*(.*))?$/i;
const actionVerb = '정리|비교|검토|작성|검증|분류|분석|확인|점검|시험|검사|수정|추가|변환|요약|제작|구현|적용|진행|실행|대조|측정|반영|조사|계산|선정|생성|설계|수집|기록|준비|조정|개선|보완';
const actionNoun = new RegExp('(?:'+actionVerb+')$');
const suggestedAction = new RegExp('^(.*?)('+actionVerb+')(?:(?:할|해\\s*볼)\\s*수\\s*(?:있습니다|있어요|있다)|해야\\s*(?:합니다|해요)|할\\s*필요가\\s*(?:있습니다|있어요)|하는\\s*(?:편이|것이|게)\\s*좋(?:습니다|아요|겠습니다))$');
function suggestion(text, reason='직전 답변의 다음 작업') {
  if (text.length < 6 || text.length > 190 || /https?:|[`<>\[\]{}"“”]|(?:어떤|무엇|어떻게|어느|아니면|또는)\s/.test(text)) return;
  if (text.split(/\s+/).length < 2 || /^(?:(?:이대로|그대로|계속|이어서|다음\s*단계(?:를|로)?)\s*)*(?:이어서\s*)?(?:진행|계속|시작)해줘$/.test(text)) return;
  return {source:'conversation', title:text, prompt:text, reason};
}
function toRequest(sentence, inSection) {
  let text = sentence.trim().replace(/^(?:원하시면|원한다면|필요하시면)\s*[,，]?\s*/, '');
  if (text.length < 6 || text.length > 190 || /https?:|[`<>\[\]{}"“”]|(?:어떤|무엇|어떻게|어느|아니면|또는)\s|(?:완료|해결|불필요|없음|생략)(?:했습니다|됐습니다|됨)?[.!]?$/.test(text)) return;
  const requestEnd = /(?:할까요|해\s*드릴까요|해\s*볼까요)[?？]$/;
  if (requestEnd.test(text)) text = text.replace(requestEnd, '해줘');
  else if (!inSection) return;
  else if (/해\s*(?:주세요|줘요|줘)[.!]?$/.test(text)) text = text.replace(/해\s*(?:주세요|줘요|줘)[.!]?$/, '해줘');
  else {
    text = text.replace(/[.]$/, '').replace(/하기$/, '');
    if (!actionNoun.test(text)) return;
    text += '해줘';
  }
  return suggestion(text);
}
// 본문에 공개된 문장만 사용한다. 작성물 / 인용 / 도구 JSON 안의 문장을 실행 제안으로 꺼내지 않는다.
export function publicLines(text) {
  const result=[];
  let fence = '', writing = false;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker.startsWith(fence) && line.trim() === marker) fence = '';
      result.push('');
      continue;
    }
    if (fence) continue;
    if (/^ {0,3}:::writing\b/.test(line)) { writing = true; result.push(''); continue; }
    if (writing) { if (/^ {0,3}:::\s*$/.test(line)) writing = false; continue; }
    if (!line.trim()) continue;
    if (line.length > 4096 || /^(?: {4}|\t|\s*[<>{[|"}])/.test(line)) { result.push(''); continue; }
    result.push(line.trim().replace(/\*\*|__/g, '').replace(/^#{1,6}\s+/, ''));
  }
  return result;
}
function declaredNext(sentence, inSection) {
  const lead=/^(?:다음(?:에는|으로|에|\s*(?:작업|단계)(?:로|에서는|에서|는)?)|이어서|추가로)\s*[,，:]?\s*/;
  const output=/\s(?:표|목록|체크리스트|보고서|비교표|한\s*(?:장|쪽))(?:로|으로)\s/;
  if (!inSection && !lead.test(sentence) && !output.test(sentence) && !/^(?:우선|먼저)\s/.test(sentence)) return;
  const body=sentence.replace(lead,'').replace(/[.!]$/,'');
  const match=suggestedAction.exec(body);
  return match?suggestion(match[1]+match[2]+'해줘'):undefined;
}
function objectParticle(text) {
  const last=text.charCodeAt(text.length-1)-0xac00;
  return last>=0 && last<11172 && last%28 ? '을' : '를';
}
function unfinishedRequest(sentence) {
  if (/제외|보류|의도적으로|범위\s*밖|하지\s*않기로|승인|필요\s*없/.test(sentence)) return;
  const body=sentence.replace(/^(?:다만|단|아직)\s*[,，]?\s*/,'');
  const match=/^(.{4,150}?)(?:은|는|을|를)\s*(?:(?:아직|이번(?:에|에는)|현재|직접)\s*)*(검증|확인|점검|시험|검사|테스트|수행|진행|실행)(?:하지\s*(?:않았|못했)|하지는\s*않았|하지\s*못한)[^.!?]*[.!]?$/.exec(body);
  if (match) {
    const target=match[1].trim(),verb=match[2]==='수행'?'진행':match[2];
    return suggestion(target+objectParticle(target)+' '+verb+'해줘','직전 답변에 남은 확인 사항');
  }
  const remaining=/^(.{4,140}?(?:검증|확인|점검|시험|검사|테스트))(?:은|는|이|가)\s*(?:아직\s*)?(?:남아\s*있습니다|남았습니다|필요합니다)[.!]?$/.exec(body);
  if (remaining) return suggestion(remaining[1]+objectParticle(remaining[1])+' 진행해줘','직전 답변에 남은 확인 사항');
  const adjustment=/^(.{4,140}?(?:조정|개선|보완|수정))(?:이|가)\s*(?:추가로\s*)?필요합니다[.!]?$/.exec(body);
  if(adjustment)return suggestion(adjustment[1]+'해줘','직전 답변에 남은 개선 사항');
  const unverified=/^(.{4,140}?)(?:은|는|이|가)\s*(?:아직\s*)?미검증(?:입니다|됐습니다)?[.!]?$/.exec(body);
  return unverified?suggestion(unverified[1]+objectParticle(unverified[1])+' 검증해줘','직전 답변에 남은 확인 사항'):undefined;
}
function answerCandidates(lines) {
  const explicit=[],unfinished=[];
  const add=(rows,candidate)=>{if(candidate)rows.push(candidate);};
  let next=false;
  for (const body of lines) {
    if (!body) {next=false;continue;}
    const heading = sectionHeading.exec(body);
    if (heading) {
      next = true;
      if (heading[1]) {
        add(explicit,toRequest(heading[1],true)||declaredNext(heading[1],true));
        add(unfinished,unfinishedRequest(heading[1]));
      }
      continue;
    }
    const task = /^(?:[-*+]\s+|\d+[.)]\s+)(?:\[ \]\s*)?/.exec(body);
    const sentence=task?body.slice(task[0].length):body;
    if (next) add(explicit,toRequest(sentence,true)||declaredNext(sentence,true));
    for (const part of sentence.split(/(?<=[.!?。])\s+/)) {
      if (part !== sentence || !next) add(explicit,toRequest(part,false)||declaredNext(part,next));
      add(unfinished,unfinishedRequest(part));
    }
    if (next && task) continue;
    next = false;
  }
  return explicit.concat(unfinished);
}
export function followupFromAnswer(text) {
  return answerCandidates(publicLines(text||''))[0];
}
// 명시적인 다음 행동 다음으로, 답변에 실제로 나온 결과의 활용 방법을 찾는다.
function contextualCandidates(body,request) {
  const context=body+'\n'+request,result=[];
  if (/매출/.test(body) && /월별|채널별|기간별|주문|온라인|스토어|쇼핑몰|판매/.test(context)
      && /(?:분석|집계|비교|정리)[^.!?\n]{0,30}(?:마쳤|완료|했습니다|했어요|끝냈)/.test(body)) {
    if (!/원인|요인|기여|영향/.test(context)) result.push(suggestion('매출 변화에 가장 크게 영향을 준 요인을 분석해줘','매출 분석 결과의 후속 확인'));
    else if (!/개선안|실행안|개선\s*과제|실행\s*계획/.test(context)) result.push(suggestion('매출 분석을 바탕으로 우선 실행할 개선안을 정리해줘','매출 분석 결과의 다음 활용'));
  }
  if (/발표자료|슬라이드/.test(body) && /완료|마쳤|작성했습니다|정리했습니다/.test(body)
      && !/발표자\s*(?:메모|노트)|발표\s*대본/.test(context)) {
    result.push(suggestion('발표자료의 핵심 내용을 발표자 메모로 정리해줘','완료한 발표자료의 다음 활용'));
  }
  const items=body.split('\n').filter(line=>/^(?:[-*+]\s+|\d+[.)]\s+)/.test(line));
  if (items.length>=3 && /비교|차이|장점|단점/.test(body) && /기준|비용|시간|성능|범위|조건/.test(body)
      && !/비교표|표로|표로는|\|.*\|/.test(context)) {
    result.push(suggestion('답변에 나온 비교 기준과 차이를 한 표로 정리해줘','답변에 있는 비교 항목 정리'));
  }
  if (items.length>=3 && /순서|절차|단계|방법/.test(body) && /확인|검증|연결|설정|준비|실행|설치|작성/.test(body)
      && !/체크리스트|\[[ xX]\]/.test(context)) {
    result.push(suggestion('안내한 작업 순서를 실행할 수 있는 체크리스트로 정리해줘','답변에 있는 작업 순서 정리'));
  }
  if (/코드|구현|함수|동작|처리 로직/.test(request) && /수정했|해결했|반영했|구현했/.test(body)
      && !/회귀|검증|테스트|시험|검사|통과/.test(body)) {
    result.push(suggestion('이번에 수정한 동작의 주요 경로를 회귀 검사해줘','직전 수정 결과의 실제 동작 확인'));
  }
  return result.filter(Boolean);
}
function normalized(text) {
  return text.normalize('NFC').replace(/(?:해주세요|해\s*주세요|해줘요?|부탁해요?)[.!\s]*$/,'').replace(/[\s\p{P}]/gu,'');
}
export function latestFollowupAnswer(session) {
  const messages = session?.messages || [];
  const last=messages.findLast(row=>row.role==='user'||row.role==='assistant'||
    (row.role==='system'&&!row.progressCommentary&&stoppedText.test(row.text)));
  return last?.role==='assistant'?last:undefined;
}
function followupContext(session) {
  const answer = latestFollowupAnswer(session);
  if (!answer?.text.trim() || (answer.id && session.completedContinuationId === answer.id)) return;
  const latestRequest = session.messages.findLast(row => row.role === 'user');
  const request = latestRequest?.sourceOnly ? '' : latestRequest?.text || '';
  if (!decline.test(request)) return {answer, request};
}
export function canOfferFollowup(session) {
  return Boolean(followupContext(session));
}
function relevanceTerms(request) {
  return new Set((request.match(/[가-힣]{2,}|[\w-]{3,}/g)||[])
    .map(word=>word.toLowerCase().replace(/(?:을|를|은|는|의|에서|하고|까지|부터)$/,''))
    .filter(word=>word.length>=2 && !/^(?:다음|작업|요청|한국어|해주세요|해줘|이어서|진행|추가)$/.test(word)));
}
function rank(row,terms) {
  const relevant=[...relevanceTerms(row.prompt)].filter(term=>terms.has(term)).length;
  const priority=/(?:^|\s)(?:우선|먼저|선행|필수)(?:$|\s)/.test(row.prompt);
  return (priority?40:0)+Math.min(relevant,4)*4;
}

const topicLead = /^(?:(?:다만|우선|먼저|이어서|따라서|실제로|현재|이번(?:에|에는|의)?|최종적으로|다시|추가로|결과적으로)\s*[,，]?\s+)+/;
const genericTopic = /^(?:내용|요청|작업|이\s*작업|상태|이\s*상태|결과|확인한\s*결과|핵심|요약|응답|답변|모두|문제|각각|방법|항목|다음\s*단계|관련\s*내용|테스트|확인|그날|내일|오늘|어제|이번엔)(?:의\s*내용)?$/;
const topicPrefix = /^(?:(?:결과|요약|현재\s*상태|확인\s*결과|검증\s*결과|완료\s*항목)\s*[:：]\s*)|^(?:[-*+]\s+|\d+[.)]\s+)(?:\[[ xX]\]\s*)?/;
const topicContent = /^[가-힣\p{L}\p{N}][가-힣\p{L}\p{N} .,_()-]*$/u;
const quietIntro = /^(?:예상\s*소요\s*시간|안녕하세요|감사합니다|도움이\s*되|요청을\s*확인|무엇을\s*도와)/;
function findTopic(lines,terms) {
  let best,score=-1;
  for (const line of [...lines.slice(0,12),...lines.slice(-32)]) {
    const sentences=line.replace(topicPrefix,'').split(/(?<=[.!?。])\s+/).slice(0,6);
    for (const sentence of sentences) {
      const clean=sentence.trim().replace(topicLead,'').replace(/[.!?。]+$/,'');
      if (clean.length<2 || quietIntro.test(clean) || /https?:|[\\/@{}<>\[\]`"“”]|\d{6,}|(?:비밀번호|승인번호|인증번호|계좌번호|인증\s*토큰)\s*[\w-]+/.test(clean)) continue;
      const keyword=/^(.{2,42}?)(?:에서는|에도|에서|은|는|이|가|을|를|으로)(?:\s|$)/.exec(clean)?.[1];
      const inner=Array.from(clean.slice(0,160).matchAll(/(?:^|\s)([가-힣]{2,18}?)(?:은|는|이|가|을|를|에서)(?=\s)/g),match=>match[1]);
      for(const term of [keyword,...inner,clean].filter(Boolean)) {
        const topic=term.replace(/^(?:해당|관련된|다른|지금의|이전의)\s+/, '').trim();
        if (topic.length>42 || !topicContent.test(topic) || genericTopic.test(topic)
            || /(?:합니다|입니다|습니다|어요|해요|할까요|해줘|해줘요|주세요)$/.test(topic)) continue;
        const relevant=[...relevanceTerms(topic)].filter(word=>terms.has(word)).length;
        const value=relevant*5+(term===clean?0:4)+Math.min(topic.split(/\s+/).length,3);
        if(value>score){best=topic;score=value;}
      }
    }
  }
  return best;
}
function contextualFallback(lines,request,terms,previous) {
  const topic=findTopic(lines,terms) || findTopic(request.split('\n'),terms);
  const answer=lines.join('\n');
  const subject=topic?'직전 답변에서 다룬 ‘'+topic+'’에 대해 ':'직전 답변을 바탕으로 ';
  const action =
    /검증|점검|검사|시험|테스트|확인했/.test(answer) ? '확인한 범위와 추가 점검 항목을 정리해줘' :
    /일정|예약|마감|기한/.test(answer) ? '확인한 기간과 다음에 확인할 항목을 정리해줘' :
    /설치|설정|연결|사용\s*방법|단계|절차/.test(answer) ? '바로 따라 할 수 있는 점검 순서를 정리해줘' :
    /문서|보고서|초안|문구|작성|정리|비교|분석/.test(answer) ? '핵심 결론과 활용할 수 있는 다음 단계 한 가지를 정리해줘' :
    '바로 적용할 수 있는 예시와 확인 방법을 정리해줘';
  const options=[
    subject+action,
    subject+'남은 질문이나 확인할 부분을 우선순위대로 알려줘',
    subject+'가장 도움이 될 후속 작업 한 가지를 알려줘',
  ];
  const next=options.find(text=>!previous.has(normalized(text))) || options.at(-1);
  return {source:'conversation',title:next,prompt:next,reason:'직전 답변의 후속 활용'};
}

// 단계마다 계산 범위가 달라 진행률은 완료한 처리 단계의 비율을 표시한다.
function *followupSteps(session) {
  const context=followupContext(session);
  if (!context) return [];
  yield 0;
  const lines=publicLines(context.answer.text);
  const request=publicLines(attachmentDisplayText(context.request)).slice(-60).join('\n');
  const terms=relevanceTerms(request);
  yield 25;
  const candidates=answerCandidates(lines);
  const previous=new Set(session.messages.slice(-12).filter(row=>row.role==='user'&&!row.sourceOnly&&row.text.length<500).map(row=>normalized(row.text)));
  yield 50;
  const best=(rows)=>{
    let candidate,score=-1;
    for (const row of rows) {
      if (previous.has(normalized(row.prompt))) continue;
      const current=rank(row,terms);
      if (current>score) {candidate=row;score=current;}
    }
    return candidate;
  };
  const candidate=best(candidates)||best(contextualCandidates(lines.join('\n'),request));
  yield 75;
  const result=candidate||contextualFallback(lines,request,terms,previous);
  yield 100;
  return [result];
}
export function originalAnswerFollowups(session) {
  const steps=followupSteps(session);
  let step=steps.next();
  while(!step.done)step=steps.next();
  return step.value;
}
export async function prepareAnswerFollowup(session,onProgress,signal) {
  const steps=followupSteps(session);
  for (let step=steps.next();!signal?.aborted;step=steps.next()) {
    if(step.done)return step.value[0];
    onProgress(step.value);
    // 다음 분석 단계로 넘어가기 전에 현재 단계를 입력창에 표시한다.
    await new Promise(resolve=>setTimeout(resolve,20));
  }
}
