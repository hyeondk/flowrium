function teamResponse(prompt, schema) {
  if (schema?.properties?.assignments && prompt.includes("[팀 배정안]"))
    return JSON.stringify({
      assignments: [
        {
          index: 0,
          title: "자료 조사",
          task: "근거 자료와 비교 기준을 확인해 주세요.",
          steps: ["출처 확인"],
          targetIndex: null,
        },
        {
          index: 1,
          title: "결과 검토",
          task: "검토 기준을 적용해 주세요.",
          steps: ["근거 대조"],
          targetIndex: null,
        },
      ],
      question: "",
      why: "",
      options: [],
    });
  if (prompt.includes("[팀 종합 보고]"))
    return "# 팀 결과 보고\n\n실제 담당자의 자료 조사와 결과 검토가 완료됐습니다.";
  if (prompt.includes("[팀원 배정]")) {
    if (
      prompt.includes("검수반려시험") &&
      prompt.includes("검수할 구현 결과 /") &&
      !prompt.includes("보완 완료 표시")
    )
      return '보완이 필요합니다.\n\n```flowrium-review\n{"passed":false,"feedback":"보완한 증거를 남겨 주세요."}\n```';
    if (prompt.includes("구현보완시험") && prompt.includes("사용자의 결정 /"))
      return "보완 완료 표시";
    if (prompt.includes("결정질문시험") && !prompt.includes("사용자의 결정 /"))
      return '담당 범위를 확인해야 합니다.\n\n```flowrium-decision\n{"question":"어느 자료를 우선할까요?","why":"두 자료의 기준이 다릅니다.","options":["내부 자료","외부 자료"]}\n```';
    return "담당 과업을 확인하고 실제 근거를 정리했습니다.";
  }
}
module.exports = { teamResponse };
