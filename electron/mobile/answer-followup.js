import {attachmentDisplayText} from './attachment-text.js';

// Recommendations only use published conversation text, on this device.
const decline = /(?:추천|제안|후속(?:\s*작업)?|다음\s*(?:단계|작업)|추가\s*질문)[^.!?\n]{0,24}(?:하지\s*마|지\s*말|없이|빼|생략|금지|필요\s*없|원하지\s*않)|(?:do not|don't|no)\s+(?:suggest|recommend|follow[ -]?up)/i;
const stoppedText = /^(?:작업을 완료하지 못했습니다\.|사용자의 요청으로 작업이 중지됐습니다\.)/;
const sectionHeading = /^(?:다음\s*(?:(?:권장|우선)\s*)?(?:작업|단계)|(?:권장\s*)?후속\s*작업|남은\s*(?:작업|사항|검증)|next steps?)\s*(?:[:：]\s*(.*))?$/i;
const reportHeading = /^(?:결과|요약|현재\s*상태|확인\s*결과|검증\s*결과|완료\s*항목)$/;
const postponed = /(?:나중에|이따(?:가)?|잠시\s*뒤에?)\s*(?:부탁|진행|연결|해\s*주|요청|할게|다시\s*(?:진행|연결|요청))/;
const actionVerb = '정리|비교|검토|작성|검증|분류|분석|확인|점검|시험|검사|수정|추가|변환|요약|제작|구현|적용|진행|실행|대조|측정|반영|조사|계산|선정|생성|설계|수집|기록|준비|조정|개선|보완';
const actionNoun = new RegExp('(?:'+actionVerb+')$');
const suggestedAction = new RegExp('^(.*?)('+actionVerb+')(?:(?:할|해\\s*볼)\\s*수\\s*(?:있습니다|있어요|있다)|해야\\s*(?:합니다|해요)|할\\s*필요가\\s*(?:있습니다|있어요)|하는\\s*(?:편이|것이|게)\\s*좋(?:습니다|아요|겠습니다))$');
const advicePrompt = /(?:순서|절차|방법|(?:필요한|먼저\s*확인할)\s*조건)(?:을|를|만|도)?\s*(?:(?:간단히|자세히|차근차근|먼저|번호로|표로|목록으로|체크리스트로)\s+){0,2}(?:정리해|요약해|설명해|알려|안내해)(?:\s*(?:줘요?|주세요|줄래요?|주실래요|주실\s*수\s*있나요))?[.!?。？\s]*$/;
const assistantPerspective = /(?:^|[\s,，])(?:제가|저는|저도|저에게|저한테|저희(?:가|는|도|에게)?)(?=$|[\s,，])|주(?:시면|신다면|시고|셔서|시기|시길)|드리(?:겠|는|면|고)|(?:할까요|볼까요|드릴까요|주실까요)|(?:^|[.!?]\s+)(?:would you like me to|shall i|should i|i (?:can|could|will|would)|if you (?:send|provide|type|paste|upload))\b/i;
const formalEnding = /(?:습니다|겠습니다|합니다|이에요|예요|있어요|없어요|세요|해요|줘요|나요|래요|까요|시오)(?=[.!?。！？](?:\s|$)|$)/;
const inputOffer = /^(?:(?:그럼|이어서|추가로)\s+)?([^,，]+?)\s+(보내|전송해|입력해|붙여넣어)\s*주(?:시면|신다면)\s*[,，]\s*제가\s+(?:받았을|수신했을)\s*때(?:도)?\s+(.+)$/;
export function isAdvisoryFollowup(text) {
  return advicePrompt.test(text);
}
export function directFollowupText(text) {
  // A test offered by the assistant becomes a request to perform that test.
  const direct = text.replace(inputOffer, '$1 $2서 수신 후에도 $3')
    .replace(/\s*(?:주세요|줘요|줄래요?|주실래요|주실\s*수\s*있나요)(?=[.!?。！？](?:\s|$)|$)/g, '줘');
  if (assistantPerspective.test(direct) || formalEnding.test(direct)) return;
  return direct;
}
function suggestion(text, reason='직전 답변의 다음 작업') {
  if (text.length < 6 || text.length > 190) return;
  text = directFollowupText(text);
  if (!text || isAdvisoryFollowup(text) || /https?:|[`<>\[\]{}"“”]|(?:어떤|무엇|어떻게|어느|아니면|또는)\s/.test(text)) return;
  if (text.split(/\s+/).length < 2 || /^(?:(?:이대로|그대로|계속|이어서|다음\s*단계(?:를|로)?)\s*)*(?:이어서\s*)?(?:진행|계속|시작)해줘$/.test(text)) return;
  return {source:'conversation', title:text, prompt:text, reason};
}
function toRequest(sentence, inSection) {
  let text = sentence.trim().replace(/^(?:원하시면|원한다면|필요하시면)\s*[,，]?\s*/, '');
  if (text.length < 6 || text.length > 190 || /https?:|[`<>\[\]{}"“”]|(?:어떤|무엇|어떻게|어느|아니면|또는)\s|(?:완료|해결|불필요|없음|생략)(?:했습니다|됐습니다|됨)?[.!]?$/.test(text)) return;
  const requestEnd = /(?:할까요|해\s*드릴까요|해\s*볼까요)[?？]$/;
  if (requestEnd.test(text)) text = text.replace(requestEnd, '해줘');
  else if (!inSection) return;
  else if (/(?:주세요|줘요?|줄래요?|주실래요|주실\s*수\s*있나요)[.!?。！？]?$/.test(text)) text = text.replace(/\s*(?:주세요|줘요?|줄래요?|주실래요|주실\s*수\s*있나요)[.!?。！？]?$/, '줘');
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
    const body=line.trim().replace(/^#{1,6}\s+/, '');
    const inlineHeading=/^(\*\*|__)([^*_]+)\1(?:\s*[:：]\s*|\s+)(\S.*)$/.exec(body);
    const title=inlineHeading?.[2].trim();
    const text=title && sectionHeading.test(title) ? title+': '+inlineHeading[3]
      : title && reportHeading.test(title) ? inlineHeading[3] : body;
    result.push(text.replace(/\*\*|__/g, ''));
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
  const match=/^(.{4,150}?)(?:은|는|을|를)\s*(?:(?:아직|이번(?:에|에는)|현재|직접)\s*)*(검증|확인|점검|시험|검사|테스트|수행|진행|실행|설치|배포|반영|적용|전환|이전|교체|복구|정리)(?:하지\s*(?:않았|못했)|하지는\s*않았|하지\s*못한)[^.!?]*[.!]?$/.exec(body);
  if (match) {
    const target=match[1].trim(),verb=match[2]==='수행'?'진행':match[2];
    return suggestion(target+objectParticle(target)+' '+verb+'해줘','직전 답변에 남은 확인 사항');
  }
  const remaining=/^(.{4,140}?(?:검증|확인|점검|시험|검사|테스트))(?:은|는|이|가)\s*(?:아직\s*)?(?:남아\s*있습니다|남았습니다|필요합니다)[.!]?$/.exec(body);
  if (remaining) return suggestion(remaining[1]+objectParticle(remaining[1])+' 진행해줘','직전 답변에 남은 확인 사항');
  const adjustment=/^(.{4,140}?(?:조정|개선|보완|수정))(?:이|가)\s*(?:추가로\s*)?필요합니다[.!]?$/.exec(body);
  if(adjustment)return suggestion(adjustment[1]+'해줘','직전 답변에 남은 개선 사항');
  const pending=/^(.{4,140}?(?:설치|배포|반영|적용|전환|이전|교체|복구|정리|완성))(?:은|는|이|가)\s*(?:(?:아직|추가로)\s*)?(?:남았습니다|남아\s*있습니다|미완료입니다)[.!]?$/.exec(body);
  if (pending) return suggestion(pending[1]+'해줘','직전 답변에 남은 작업');
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
  return answerCandidates(publicLines(text||'').filter(line=>!riskyLine.test(line)))[0];
}
// 명시된 다음 작업이 없으면 최신 답변에 나온 기능이나 산출물에 적용할 후속 작업을 찾는다.
function contextualCandidates(body,request) {
  const context=body+'\n'+request,result=[];
  if (/(?:현재|실시간)\s*작업|작업\s*내역/.test(body) && /스크롤/.test(body)
      && /고정|갱신|같은\s*(?:자리|줄|위치)/.test(body) && /새\s*(?:작업|기록|이벤트)|업데이트/.test(context)
      && !/연속\s*(?:입력|갱신|이벤트).*회귀|회귀\s*테스트.*스크롤/.test(body)) {
    result.push(suggestion('작업 내역 위쪽을 읽는 중에 테스트용 작업 이벤트를 연속으로 넣고, 현재 작업 줄과 읽던 위치가 밀리지 않는지 확인하는 회귀 테스트를 추가해줘','최신 답변의 실시간 작업 표시와 스크롤 유지 검증'));
  }
  if (/휴대폰|아이폰/.test(body) && /중계|QR|연결\s*주소/.test(body) && /재시작|다시\s*열/.test(body)
      && /재연결|재접속|유지|QR\s*없이/.test(body) && !/잠시\s*끊|중단.*자동\s*복구|일시\s*장애/.test(body)) {
    result.push(suggestion('시험 중계에 잠깐 응답 지연을 넣고 휴대폰이 저장된 연결 주소로 자동 복구되는지 검증해줘','최신 답변의 휴대폰 재접속에 일시 장애 조건 추가'));
  }
  if (/다운로드\s*버튼|설치\s*버튼/.test(body) && /맥|Mac/i.test(body) && /윈도우|Windows/i.test(body)
      && /최신\s*(?:버전|판)|새\s*(?:버전|설치본)|배포/.test(body) && !/이전\s*(?:버전|판)\s*링크|버전\s*갱신\s*회귀/.test(body)) {
    result.push(suggestion('공식 홈페이지의 맥·윈도우 설치 버튼이 공개 최신 태그와 같은 버전을 가리키는지 자동으로 검사해줘','최신 답변의 두 플랫폼 다운로드 링크 교차 검사'));
  }
  if (/매출/.test(body) && /월별|채널별|기간별|주문|온라인|스토어|쇼핑몰|판매/.test(context)
      && /(?:분석|집계|비교|정리)[^.!?\n]{0,30}(?:마쳤|완료|했습니다|했어요|끝냈)/.test(body)) {
    const canCompareOrders = /(?:전월|지난달)\s*대비[^\n]{0,20}\d+(?:\.\d+)?\s*%/.test(body)
      && /주문\s*(?:수|건수)/.test(body) && /평균\s*주문\s*(?:금액|액)|객단가/.test(body)
      && !/기여액|기여\s*금액|요인별\s*(?:금액|기여)/.test(context);
    if (canCompareOrders) result.push(suggestion('원자료에서 전월과 이번 달 수치를 대조해 매출 증감액을 주문 수와 평균 주문 금액의 기여액으로 나누고, 각각의 금액을 비교표로 보여줘','최신 답변의 두 매출 지표가 증가분에 기여한 금액 계산'));
    else if (!/원인|요인|기여|영향/.test(context)) result.push(suggestion('매출 변화에 가장 크게 영향을 준 요인을 분석해줘','매출 분석 결과의 후속 확인'));
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
  return result.filter(Boolean);
}
function normalized(text) {
  return text.normalize('NFC').replace(/(?:\s*(?:줘요?|주세요|줄래요?|주실래요|주실\s*수\s*있나요)|\s*부탁해요?)[.!?？\s]*$/,'').replace(/[\s\p{P}]/gu,'');
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
const stopWords = /^(?:다음|작업|요청|한국어|이어서|계속|진행|추가|현재|지금|여기|앞서|직전|결과|대상|항목|부분|답변|내용|방법|가장|해당|같은|다시|그대로|제발|한번|완료|필요|확인|때문|해\s*(?:주세요|줘요?)|(?:있|없|됐|하)(?:어요|습니다)|(?:알려|확인해|진행해|봐|해)\S*(?:줘|줄래|주세요|주실래요)|a|an|the|this|that|some|any|also|all|please|can|could|would|let|make|done)$/i;
function relevanceTerms(text) {
  return new Set((text.toLowerCase().match(/[가-힣]{2,}|[a-z][\w-]{2,}/g)||[])
    .map(word=>word.replace(/(?:에서는|에서도|에서|하고|까지|부터|까지도|마다|만큼|으로|로|을|를|은|는|의|에|도|이|가)$/, ''))
    .filter(word=>word.length>=2 && word.length<=36 && !stopWords.test(word)));
}
function rank(row,requestTerms,historyTerms) {
  const terms=[...relevanceTerms(row.prompt)];
  const direct=terms.filter(term=>requestTerms.has(term)).length;
  const related=terms.reduce((total,term)=>total+(historyTerms.get(term)||0),0);
  const priority=/(?:^|\s)(?:우선|먼저|선행|필수)(?:$|\s)/.test(row.prompt);
  return (priority?40:0)+Math.min(direct,4)*8+Math.min(related,28);
}

const quietIntro = /^(?:예상\s*소요\s*시간|안녕하세요|감사합니다|도움이\s*되|요청을\s*확인|무엇을\s*도와)/;
const riskyLine = /https?:|[\u0000-\u0008]|[\\@{}<>]|(?:^|[\s'"`])\/[\w.가-힣][^\s]*\/|(?:비밀번호|승인번호|인증번호|계좌번호|인증\s*토큰|비밀\s*키)[^\n]{0,25}[0-9A-Za-z_-]{4,}|(?:^|\s)\d{6,}(?:\s|$)/;
const pingRequest = /^(?:(?:그냥|다시|한\s*번\s*더|재차|이번(?:에도|엔))\s+)*(?:(?:(?:채팅|응답|답변|전송|메시지|대화|연결)\s*(?:을|를)?\s*)?(?:테스트|확인|시험)|(?:안녕(?:하세요)?|고마워(?:요)?|감사합니다)|(?:ping|test|hello|hi|thanks))(?:\s*(?:만|해\s*줘요?|해\s*주세요|입니다|예요|할게요))?[.!?！?…\s]*$/i;
const pingReply = /^(?:안녕|반갑|천만에|별말씀|감사)|(?:메시지|채팅|답변|응답|테스트)[^.!?\n]{0,45}(?:잘\s*받|보이면|주고받|수신했)|(?:pong|test\s*(?:passed|received)|message\s*received)/i;
const shallowRequest = /^(?:(?:그(?:대|렇)로|앞서|같은|이어서|계속|다시|추가로|한\s*번\s*더|해당|지금|좋아|네|응|그럼|위와|동일한|조건(?:으로)?)\s*[,，]?\s*)+(?:진행|설명|계속|수정|해|정리|확인)?(?:해\s*)?(?:주세요|줘요?|줄래요?|주실래요)?[.!?。？\s]*$/i;

function plainHistoryLines(text) {
  return publicLines(attachmentDisplayText(text)).filter(line=>line && !quietIntro.test(line) && !riskyLine.test(line));
}
function historyContext(session,answer,request) {
  const terms=new Map(),previous=new Set(),prior=[];
  const requestLines=plainHistoryLines(request),requestTerms=relevanceTerms(requestLines.join(' '));
  const usableRequest=requestLines.length && !requestLines.every(line=>pingRequest.test(line)||shallowRequest.test(line));
  let seen=0;
  for (let index=session.messages.lastIndexOf(answer)-1;index>=0;index--) {
    const row=session.messages[index];
    if (!row.text || row.sourceOnly || row.progressCommentary || !['user','assistant'].includes(row.role)) continue;
    seen++;
    // Long records contribute both their purpose and latest conclusions. Keep
    // indexing bounded per message while visiting older turns as evidence.
    const input=row.text.length>6000 ? row.text.slice(0,3000)+'\n'+row.text.slice(-3000) : row.text;
    const lines=plainHistoryLines(input);
    if (!lines.length) continue;
    if (row.role==='user' && lines.length<7 && input.length<600) previous.add(normalized(lines.join(' ')));
    const meaningful=lines.filter(line=>!pingRequest.test(line) && !shallowRequest.test(line) && !pingReply.test(line));
    if (!meaningful.length) continue;
    const importance=(row.role==='user'?1.5:1)*(1+4/Math.sqrt(seen));
    for (const term of relevanceTerms(meaningful.join(' '))) {
      const priorWeight=terms.get(term)||0;
      terms.set(term,Math.min(12,Math.max(priorWeight,importance)+Math.min(priorWeight,importance)*.1));
    }
    if (prior.length<14) prior.push({lines:meaningful,user:row.role==='user'});
  }
  return {terms,previous,prior,requestLines,requestTerms,usableRequest};
}
function isPing(lines,requestLines) {
  if (!requestLines.length || !requestLines.every(line=>pingRequest.test(line))) return false;
  const prose=lines.filter(line=>line && !quietIntro.test(line));
  return !prose.length || prose.every(line=>pingReply.test(line)) && !answerCandidates(prose).length;
}
function specifyScope(candidate,history) {
  if (!candidate || /대화|채팅/.test(candidate.prompt)) return candidate;
  const context=history.requestLines.join(' ')+' '+history.prior.filter(turn=>turn.user).slice(0,3).flatMap(turn=>turn.lines).join(' ');
  // The last answer can refer to the conversation only by an operation. Reuse
  // the named test conversation and destination the user actually mentioned.
  const target=/(?:시험|임시|합성|테스트)\s+(?:채팅|대화)/.exec(context)?.[0];
  const action=/^(?:(?:먼저|우선)\s+)?(제목 변경|이름 변경|삭제)(와 삭제|과 삭제|과 제목 변경|와 이름 변경)?(?:을|를)?\s*(?:검증|확인|시험)해줘$/.exec(candidate.prompt);
  if (!target || !action) return candidate;
  const place=/양쪽|두\s*(?:쪽|앱)|양방향/.test(context) ? '양쪽 앱에 ' : '';
  const what=action[1]+(action[2]||'');
  return suggestion(target+'의 '+what+(objectParticle(what)==='을'?'이':'가')+' '+place+'반영되는지 확인해줘',candidate.reason) || candidate;
}

const previousBuild = /(?:(?:이전|예전|구형|기존|직전)\s*(?:버전|설치본|빌드|실행\s*파일|앱\s*사본)|구\s*버전)/;
const currentBuild = /(?:최신|새(?:로운)?|신규|새로\s*설치한)\s*(?:버전|설치본|빌드|실행\s*파일|앱\s*사본)/;
const removeFiles = /(?:지워|지우|삭제|제거|비워|정리해|정리\s*부탁)/;
const preservePrevious = new RegExp(previousBuild.source+/(?:\s*(?:실행\s*파일|설치본|빌드|사본|파일(?:들)?))?(?:은|는|을|를|도)?\s*(?:(?:그대로|모두|계속)\s+)*(?:유지해|보존해|남겨\s*(?:둬|두|줘)|삭제하지\s*마|지우지\s*마)/.source);
const activeUse = /(?:사용|실행|가동|동작)\s*(?:중|하고\s*있|하는)|(?:참조|의존)하(?:고\s*있|는)/;
const keptFiles = /유지했|보존했|보류했|남겼|남겨\s*(?:뒀|두었)|(?:삭제|제거|정리|지우)하지\s*(?:않|못)/;
const phoneRelay = /(?:아이폰|휴대폰|모바일)(?:\s+연결)?\s*(?:중계|터널)|(?:cloudflared|Cloudflare\s*(?:중계|터널))/i;
const noOpenWork = /(?:추가로\s*(?:진행|할)\s*(?:작업|일)|추가\s*조치(?:가\s*필요한\s*사항)?|남은\s*(?:작업|사항))\s*(?:은|는|이|가)?\s*(?:없습니다|없어요|없음)(?=$|[.!?\s])/;

function activeBuildFollowup(lines,history) {
  const request = history.usableRequest ? history.requestLines.join('\n')
    : history.requestLines.some(line=>shallowRequest.test(line))
      ? history.prior.find(turn=>turn.user)?.lines.join('\n') || '' : '';
  if (!previousBuild.test(request) || !removeFiles.test(request) || preservePrevious.test(request)) return;

  const answer = lines.join('\n');
  const sentences = answer.split(/(?<=[.!?。])\s+|\n/);
  const dependency = sentences.find(sentence=>activeUse.test(sentence) && phoneRelay.test(sentence) && (
    previousBuild.test(sentence) || (!currentBuild.test(sentence) && keptFiles.test(sentence) &&
      /(?:실행\s*파일|설치본|빌드|사본)/.test(sentence) && previousBuild.test(answer))
  ));
  if (!dependency || /(?:실행\s*파일|중계|터널)(?:은|는|이|가|도|을|를)?\s*(?:이미\s*)?(?:새|최신)\s*(?:버전|빌드)(?:에|으?로)[^.?!\n]{0,15}(?:옮겼|전환했|교체했|바꿨)/.test(dependency)) return;

  const context = [answer, request, ...history.prior.filter(turn=>turn.user).flatMap(turn=>turn.lines)].join('\n');
  const relay = phoneRelay.exec(dependency)[0];
  const device = /아이폰|휴대폰|모바일/.exec(relay)?.[0] || '휴대폰';
  const preserveConnection = /QR[^.?!\n]{0,28}(?:재스캔\s*없이|다시\s*(?:안\s*찍|찍지)|재연결\s*없이)/i.test(context)
    ? 'QR을 다시 찍지 않도록 기존 연결을 유지하면서 ' : '기존 연결을 유지하면서 ';
  const cleanup = /직전\s*(?:버전\s*)?복구본/.test(answer)
    ? '교체가 확인되면 직전 복구본만 남기고 나머지 이전 빌드를 정리해줘'
    : '교체가 확인되면 이전 빌드를 정리해줘';
  return suggestion(preserveConnection+device+' 중계를 최신 버전으로 옮기고, '+cleanup,'이전 빌드 정리를 막은 실행 중 의존성');
}

// 단계마다 계산 범위가 달라 진행률은 완료한 처리 단계의 비율을 표시한다.
function *followupSteps(session) {
  const context=followupContext(session);
  if (!context) return [];
  yield 0;
  const lines=publicLines(context.answer.text).filter(line=>!riskyLine.test(line));
  const answer=lines.join('\n');
  const history=historyContext(session,context.answer,context.request);
  yield 25;
  const ping=isPing(lines,history.requestLines);
  const candidates=ping?[]:answerCandidates(lines);
  yield 50;
  const best=(rows)=>{
    let candidate,score=-1;
    for (const row of rows) {
      if (history.previous.has(normalized(row.prompt))) continue;
      const current=rank(row,history.requestTerms,history.terms);
      if (current>score) {candidate=row;score=current;}
    }
    return candidate;
  };
  const dependency=ping?undefined:activeBuildFollowup(lines,history);
  const request=history.requestLines.join('\n');
  const canInferNext=!ping&&!noOpenWork.test(answer)&&!(postponed.test(request)&&postponed.test(answer));
  const candidate=dependency&&!history.previous.has(normalized(dependency.prompt)) ? dependency
    : best(candidates)||(canInferNext?best(contextualCandidates(answer,request)):undefined);
  yield 75;
  const result=specifyScope(candidate,history);
  yield 100;
  return result?[result]:[];
}
export function canOfferFollowup(session) {
  const context=followupContext(session);
  if (!context) return false;
  const request=attachmentDisplayText(context.request).trim();
  return !(pingRequest.test(request) && isPing(publicLines(context.answer.text),[request]));
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
