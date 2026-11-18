// Recommendations only use published conversation text, on this device.
const decline = /(?:추천|제안|후속(?:\s*작업)?|다음\s*(?:단계|작업)|추가\s*질문)[^.!?\n]{0,24}(?:하지\s*마|지\s*말|없이|빼|생략|금지|필요\s*없|원하지\s*않)|(?:do not|don't|no)\s+(?:suggest|recommend|follow[ -]?up)/i;
const sectionHeading = /^(?:다음\s*(?:작업|단계)|후속\s*작업|남은\s*(?:작업|사항)|next steps?)\s*(?:[:：]\s*(.*))?$/i;
const actionNoun = /(?:정리|비교|검토|작성|검증|분류|분석|확인|점검|시험|수정|추가|변환|요약|제작|구현|적용|진행|실행|대조|측정|반영|조사|계산|선정|생성)$/;
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
function publicLines(text) {
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
  if (!inSection && !lead.test(sentence) && !output.test(sentence)) return;
  const body=sentence.replace(lead,'').replace(/[.!]$/,'');
  const match=/^(.*?)(정리|비교|검토|작성|검증|분류|분석|확인|점검|시험|수정|추가|변환|요약|제작|구현|적용|진행|실행|대조|측정|반영|조사|계산|선정|생성)(?:할|해\s*볼)\s*수\s*(?:있습니다|있어요|있다)$/.exec(body);
  return match?suggestion(match[1]+match[2]+'해줘'):undefined;
}
function objectParticle(text) {
  const last=text.charCodeAt(text.length-1)-0xac00;
  return last>=0 && last<11172 && last%28 ? '을' : '를';
}
function unfinishedRequest(sentence) {
  if (/제외|보류|의도적으로|범위\s*밖|하지\s*않기로|승인|필요\s*없/.test(sentence)) return;
  const body=sentence.replace(/^(?:다만|단|아직)\s*[,，]?\s*/,'');
  const match=/^(.{4,150}?)(?:은|는|을|를)\s*(?:(?:아직|이번(?:에|에는)|현재|직접)\s*)*(검증|확인|점검|시험|테스트|수행|진행|실행)(?:하지\s*(?:않았|못했)|하지는\s*않았|하지\s*못한)[^.!?]*[.!]?$/.exec(body);
  if (match) {
    const target=match[1].trim(),verb=match[2]==='수행'?'진행':match[2];
    return suggestion(target+objectParticle(target)+' '+verb+'해줘','직전 답변에 남은 확인 사항');
  }
  const remaining=/^(.{4,140}?(?:검증|확인|점검|시험|테스트))(?:은|는|이|가)\s*(?:아직\s*)?(?:남아\s*있습니다|남았습니다|필요합니다)[.!]?$/.exec(body);
  return remaining?suggestion(remaining[1]+'을 진행해줘','직전 답변에 남은 확인 사항'):undefined;
}
function answerCandidates(text) {
  const explicit=[],unfinished=[],lines=publicLines(text||'');
  let next=false;
  for (const body of lines) {
    if (!body) {next=false;continue;}
    const heading = sectionHeading.exec(body);
    if (heading) {
      next = true;
      if (heading[1]) {
        explicit.push(toRequest(heading[1],true)||declaredNext(heading[1],true));
        unfinished.push(unfinishedRequest(heading[1]));
      }
      continue;
    }
    const task = /^(?:[-*+]\s+|\d+[.)]\s+)(?:\[ \]\s*)?/.exec(body);
    const sentence=task?body.slice(task[0].length):body;
    if (next) explicit.push(toRequest(sentence,true)||declaredNext(sentence,true));
    for (const part of sentence.split(/(?<=[.!?。])\s+/)) {
      explicit.push(toRequest(part,false)||declaredNext(part,next));
      unfinished.push(unfinishedRequest(part));
    }
    if (next && task) continue;
    next = false;
  }
  return {candidates:[...explicit,...unfinished].filter(Boolean),body:lines.join('\n')};
}
export function followupFromAnswer(text) {
  return answerCandidates(text).candidates[0];
}
// 명시 제안이 없는 완료 답변도 결과에 실제로 언급된 주제에서만 후속 작업을 찾는다.
// 임의 프로젝트 추측 / 모델 호출 / 반복되는 범용 "검토해줘" 제안은 하지 않는다.
function contextualCandidates(body,request) {
  const context=body+'\n'+publicLines(request).join('\n'),result=[];
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
  return result.filter(Boolean);
}
function normalized(text) {
  return text.normalize('NFC').replace(/(?:해주세요|해\s*주세요|해줘요?|부탁해요?)[.!\s]*$/,'').replace(/[\s\p{P}]/gu,'');
}
export function latestFollowupAnswer(session) {
  const messages = session?.messages || [];
  const last=messages.findLast(row=>row.role==='user'||row.role==='assistant');
  return last?.role==='assistant'?last:undefined;
}
export function originalAnswerFollowups(session) {
  const messages = session?.messages || [],last=latestFollowupAnswer(session);
  if (!last || (last.id && session.completedContinuationId === last.id)) return [];
  const request = messages.findLast(row => row.role === 'user')?.text || '';
  if (decline.test(request)) return [];
  const {candidates,body}=answerCandidates(last.text);
  const previous=new Set(messages.slice(-12).filter(row=>row.role==='user'&&row.text.length<500).map(row=>normalized(row.text)));
  const candidate=[...candidates,...contextualCandidates(body,request)].find(row=>!previous.has(normalized(row.prompt)));
  return candidate?[candidate]:[];
}
