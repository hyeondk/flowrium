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
  if (effort && !["low","medium","high"].includes(effort)) throw new Error("대화 추론 강도를 확인해 주세요.");
  const url = chatAddress(input.chatGptUrl);
  return { ...(model && {model}), ...(effort && {effort}), ...(url && {chatGptUrl:url}) };
}
module.exports={preferences,chatAddress};
