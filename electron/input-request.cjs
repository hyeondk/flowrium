const invalid = () => new Error("Codex 질문의 형식을 확인해 주세요.");
function string(value, max, allowEmpty = false) {
  if (
    typeof value !== "string" ||
    (!allowEmpty && !value.trim()) ||
    value.length > max ||
    value.includes("\0")
  )
    throw invalid();
  return value;
}
function questionParams(params) {
  if (
    !params ||
    !Array.isArray(params.questions) ||
    !params.questions.length ||
    params.questions.length > 32 ||
    typeof params.isBlocking !== "boolean"
  )
    throw invalid();
  const seen = new Set();
  const questions = params.questions.map((q) => {
    const id = string(q?.id, 500);
    if (seen.has(id)) throw invalid();
    seen.add(id);
    if (
      q.options != null &&
      (!Array.isArray(q.options) || q.options.length > 100)
    )
      throw invalid();
    const options = (q.options || []).map((option) => ({
      label: string(option?.label, 2000),
      description: string(option?.description, 8000, true),
    }));
    if (q.isSecret !== undefined && typeof q.isSecret !== "boolean")
      throw invalid();
    if (q.isOther !== undefined && typeof q.isOther !== "boolean")
      throw invalid();
    return {
      id,
      header: string(q.header, 2000, true),
      question: string(q.question, 16000),
      options,
      isOther: q.isOther === true,
      isSecret: q.isSecret === true,
    };
  });
  return {
    threadId: string(params.threadId, 500),
    turnId: string(params.turnId, 500),
    itemId: string(params.itemId, 500),
    isBlocking: params.isBlocking,
    questions,
  };
}
function responseFor(questions, answers) {
  if (
    !answers ||
    typeof answers !== "object" ||
    Array.isArray(answers) ||
    Object.keys(answers).length !== questions.length
  )
    throw new Error("모든 질문에 답해 주세요.");
  const entries = questions.map((q) => {
    const values = Object.hasOwn(answers, q.id) && answers[q.id]?.answers;
    if (
      !Array.isArray(values) ||
      values.length !== 1 ||
      typeof values[0] !== "string" ||
      !values[0].trim() ||
      values[0].length > 16000 ||
      values[0].includes("\0")
    )
      throw new Error("각 질문에 답변 한 개를 입력해 주세요.");
    const answer = values[0];
    if (
      q.options.length &&
      !q.isOther &&
      !q.options.some((o) => o.label === answer)
    )
      throw new Error("질문에 표시된 보기 중 하나를 선택해 주세요.");
    return [q.id, { answers: [answer] }];
  });
  return { answers: Object.fromEntries(entries) };
}
module.exports = { questionParams, responseFor };
