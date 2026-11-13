function teamResponse(prompt, schema) {
  if(prompt.includes("[개인 비서 상태 보고]"))return "# 프로젝트 현황 보고\n\n실제 수집한 프로젝트와 Git 기록을 확인했습니다.\n\n## 결정할 사항\n\n담당 과업의 근거를 확인합니다.\n\n## 다음 행동\n\n검토할 자료를 순서대로 정리합니다.";
  if(schema?.properties?.complete&&prompt.includes("[팀 추가 배정]")){
    const extra=prompt.includes("동적추가시험")&&!prompt.includes("2 / 추가 검증 / done");
    return JSON.stringify({complete:!extra,assignments:extra?[{index:2,title:"추가 검증",task:"빠진 근거를 추가 확인하세요.",steps:["추가 근거 확인"],targetIndex:null}]:[],question:"",why:"",options:[]});
  }
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
  if(prompt.includes("[통합 담당 위임]"))return "통합 폴더의 실제 변경과 검증 결과를 확인했습니다.";
  if (prompt.includes("[팀원 배정]")) {
    if(prompt.includes("자동QA시험")||prompt.includes("자동QA한도시험")){
      if(prompt.includes("검수할 구현 결과 /")){
        const passed=prompt.includes("보완 완료 표시")&&!prompt.includes("자동QA한도시험");
        return passed?"검수 통과":'추가 보완이 필요합니다.\n\n```flowrium-review\n{"passed":false,"feedback":"문제를 보완하고 보완 완료 표시를 남겨 주세요."}\n```';
      }
      return prompt.includes("검수 보완 요청")?"보완 완료 표시":"초기 구현 근거";
    }
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
