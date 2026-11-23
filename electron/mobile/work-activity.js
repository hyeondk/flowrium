const phrases = {
  '명령 실행': ['명령을 실행하고 있습니다', '명령을 실행했습니다'],
  '파일 읽기': ['파일을 읽고 있습니다', '파일을 읽었습니다'],
  '파일 목록 확인': ['파일 목록을 확인하고 있습니다', '파일 목록을 확인했습니다'],
  '파일 검색': ['파일을 검색하고 있습니다', '파일을 검색했습니다'],
  '파일 변경': ['파일을 변경하고 있습니다', '파일을 변경했습니다'],
  '웹 검색': ['웹을 검색하고 있습니다', '웹을 검색했습니다'],
  '웹 페이지 열기': ['웹 페이지를 열고 있습니다', '웹 페이지를 열었습니다'],
  '웹 페이지에서 찾기': ['웹 페이지에서 찾고 있습니다', '웹 페이지에서 찾았습니다'],
  '연결 도구': ['연결 도구를 사용하고 있습니다', '연결 도구를 사용했습니다'],
  '작업 도구': ['작업 도구를 사용하고 있습니다', '작업 도구를 사용했습니다'],
  '이미지 확인': ['이미지를 확인하고 있습니다', '이미지를 확인했습니다'],
  '이미지 생성': ['이미지를 생성하고 있습니다', '이미지를 생성했습니다'],
  '문맥 정리': ['대화 문맥을 정리하고 있습니다', '대화 문맥을 정리했습니다'],
};

export const agentActivityText = {
  running:'작업을 시작했습니다', completed:'작업을 마쳤습니다',
  failed:'작업 결과를 받지 못했습니다', interrupted:'작업을 중단했습니다',
};

export function describeActivity(step) {
  const {label, state, kind, target, outcome, exitCode}=step;
  if (kind === 'approval' || kind === 'question') return {label};
  if (outcome === 'noMatches') return {label, target, result:'일치 항목 없음'};
  if (outcome === 'declined') return {label, target, result:'실행하지 않음'};
  if (state === 'interrupted') return {label, target, result:'중단'};
  if (state === 'failed') return {label,target,result:exitCode===undefined?'결과를 받지 못함':`종료 코드 ${exitCode}`};
  const verbs = Object.hasOwn(phrases,label) ? phrases[label] : undefined;
  return {label:verbs?.[state==='running'?0:1] || label, target,
    ...(!verbs && state && {result:state==='running'?'작업 중':'완료'})};
}

export function activityText(step) {
  const {label,target,result}=describeActivity(step);
  return [label,target,result].filter(Boolean).join(' / ');
}

export function sameWorkActivity(a,b) {
  return Boolean(a?.kind && b && !['approval','question'].includes(a.kind) && !a.agents?.length && !b.agents?.length &&
    a.kind===b.kind && a.state===b.state && activityText(a)===activityText(b));
}
