function chatAddress(value) {
  if (!value) return undefined;
  let url;
  try { url = new URL(value); } catch { throw new Error("ChatGPT 대화 주소를 확인해 주세요."); }
  if (url.origin !== "https://chatgpt.com" || url.username || url.password ||
      !/^\/(?:g\/g-[A-Za-z0-9_-]+\/)?c\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/?$/i.test(url.pathname))
    throw new Error("ChatGPT에서 연결할 대화를 열어 주소창의 대화 주소를 붙여 넣어 주세요.");
  return url.origin + url.pathname;
}
function preferences(input) {
  if (!input || typeof input !== "object") throw new Error("대화별 설정을 확인해 주세요.");
  const model = input.model || undefined, effort = input.effort || undefined;
  if (model && (typeof model !== "string" || model.length > 300 || !model.trim())) throw new Error("대화 모델을 확인해 주세요.");
  if (effort && !["none","minimal","low","medium","high","xhigh","max","ultra"].includes(effort)) throw new Error("대화 추론 강도를 확인해 주세요.");
  const url = chatAddress(input.chatGptUrl);
  const result={ ...(model && {model}), ...(effort && {effort}), ...(url && {chatGptUrl:url}) };
  const enums={answerLength:["short","normal","detailed"],sandbox:["read-only","workspace-write","danger-full-access"],approval:["on-request","never"]};
  for(const [key,values] of Object.entries(enums))if(input[key]!==undefined){if(!values.includes(input[key]))throw Error("대화 동작 설정을 확인해 주세요.");result[key]=input[key];}
  for(const key of ["testing","askNext","autoCompact","networkAccess"])if(input[key]!==undefined){if(typeof input[key]!=="boolean")throw Error("대화 설정의 켜짐 여부를 확인해 주세요.");result[key]=input[key];}
  if(input.compactAt!==undefined){if(!Number.isInteger(input.compactAt)||input.compactAt<50||input.compactAt>95)throw Error("압축 기준은 50%부터 95%까지 정할 수 있습니다.");result.compactAt=input.compactAt;}
  return result;
}
function resolved(defaults={},own={}) {return {answerLength:"normal",testing:true,askNext:false,autoCompact:true,compactAt:80,...preferences(defaults),...preferences(own)};}
function instructions(prefs) {
  return [prefs.answerLength==="short"?"답변은 결론과 핵심만 간결하게 작성하세요.":prefs.answerLength==="detailed"?"답변에 이유와 근거, 필요한 대안까지 자세히 설명하세요.":"답변은 일반적인 길이로 명확하게 작성하세요.",
    prefs.testing?"구현과 수정 뒤에는 적절한 검증을 수행하고 실제 검증 결과를 보고하세요.":"테스트 작성과 실행은 사용자가 요청한 범위에서 수행하세요.",
    prefs.askNext?"작업을 마치면 다음에 할 일을 제시하고 계속할지 사용자에게 물으세요.":"명시한 작업을 마치고 결과를 보고하세요."].join("\n");
}
module.exports={preferences,chatAddress,resolved,instructions};
