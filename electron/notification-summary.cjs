// This is a local excerpt of the published answer, never a new model request.
// Verification is only quoted from an explicit verification section.
function readable(value) {
  return String(value || "")
    .replace(/^`{3}[\s\S]*?(?:`{3}|$)|^~{3}[\s\S]*?(?:~{3}|$)/gm, "")
    .replace(/^\s*:::(?:writing(?:\{[^}]*\})?)?\s*$/gmu,"")
    .replace(/:codex-file-citation\{[^}]*\}/g, "")
    .replace(/<send_user_message_question_reply>[\s\S]*?(?:<\/send_user_message_question_reply>|$)/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/[•·]/g, " / ");
}
function excerpt(value, fallback) {
  const plain = readable(value).replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "").replace(/\s+/g, " ").trim();
  if (!plain || /(?:\/Users\/|\/home\/|[A-Z]:\\|<[^>]+>|\{\s*["'])/.test(plain)) return fallback;
  // Do not cut a clause in half: a negative qualifier might otherwise disappear.
  if (plain.length <= 74) return plain;
  if (/(?:않|못|실패|미검증|미확인|아직|남았|하지만|다만|그러나)/.test(plain)) return fallback;
  const sentence = plain.match(/^.{1,74}?[.!?](?:\s|$)/u)?.[0]?.trim();
  return sentence || fallback;
}
function answerSections(body) {
  const sections = { result: [], verified: [], remaining: [] };
  let beforeResults = [];
  let explicitResults = false;
  let section = "result";
  for (const raw of readable(body).split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:#{1,6}\s*|[-*+]\s+)/, "").trim();
    if (!line) continue;
    const heading = /^(완료한 내용|완료 내용|작업 결과|결과|검증 결과|검증|남은 사항|남은 작업|반영 위치)\s*(?:(?:\/|[:：])\s*(.*))?$/.exec(line);
    if (heading) {
      section = /^검증/.test(heading[1]) ? "verified" : /^남은/.test(heading[1]) ? "remaining" : heading[1] === "반영 위치" ? "location" : "result";
      if(section==="result"&&!explicitResults){beforeResults=sections.result;sections.result=[];explicitResults=true;}
      if (heading[2] && sections[section]) sections[section].push(heading[2]);
    } else if (sections[section]) sections[section].push(line);
  }
  return { ...sections,result:[...sections.result,...beforeResults] };
}
function completionSummary(body, status = "completed") {
  const sections = answerSections(body);
  const complete = status === "completed";
  const result = complete
    ? excerpt(sections.result[0], "응답을 마쳤습니다. 결과는 대화에서 확인해 주세요.")
    : status === "interrupted" ? "작업이 중지되었습니다." : "작업을 완료하지 못했습니다.";
  const verified = excerpt(sections.verified[0], "검증 내용은 대화에서 확인해 주세요.");
  const remaining = excerpt(sections.remaining[0], complete ? "후속 작업은 대화에서 확인해 주세요." : "대화에서 중단 원인을 확인해 주세요.");
  return [`결과 / ${result}`, `검증 / ${verified}`, `남은 사항 / ${remaining}`].join("\n");
}
function completionPreview(body, status) {
  if (status === "interrupted") return "작업이 중지되었습니다.";
  if (status !== "completed") return "작업을 완료하지 못했습니다. 대화에서 원인을 확인해 주세요.";
  const candidate = answerSections(body).result
    .map(line => line.replace(/^\s*\d+[.)]\s+|\s+$/g, "").replace(/\s+/g, " ").trim())
    .find(line => line && !/^(?:예상 소요 시간|소요 시간|검증 결과|반영 위치)(?:은|는)?(?:\s|[:：])/u.test(line) &&
      !/(?:\/Users\/|\/home\/|[A-Z]:\\|<[^>]+>|\{\s*["'])/.test(line));
  if (!candidate) return "답변을 마쳤습니다. 대화에서 자세히 확인해 주세요.";
  const characters = Array.from(candidate);
  if (characters.length <= 70) return candidate;
  if (/(?:않|못|실패|미검증|미확인|아직|남았|하지만|다만|그러나)/u.test(candidate)) return "답변에서 결과와 제한 사항을 함께 확인해 주세요.";
  const head = characters.slice(0, 69).join("");
  const boundary = head.lastIndexOf(" ");
  return (boundary > 39 ? head.slice(0, boundary) : head) + "…";
}
function notificationConversationTitle(value) {
  if (typeof value !== "string") return "";
  const clean = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/gu, " ").trim();
  const characters = Array.from(clean);
  return characters.length <= 80 ? clean : characters.slice(0, 79).join("") + "…";
}

module.exports = { completionSummary, completionPreview, notificationConversationTitle };
