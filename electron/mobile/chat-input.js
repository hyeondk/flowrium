// Matches the largest single message that a saved Flowrium conversation can reopen.
export const maxChatInput = 2_000_000;
export const maxRequestBytes = 20 * 1024 * 1024;
export const chatLengthError = '한 번에 보낼 수 있는 원문은 UTF-8 기준 20MB까지입니다. 입력한 글을 나누어 보내 주세요.';
export function exceedsChatSize(text) {
  return text.length > maxChatInput && (text.length > maxRequestBytes || new TextEncoder().encode(text).length > maxRequestBytes);
}

export function chatInput(value, hasAttachments = false) {
  if (typeof value !== 'string') throw Error('보낼 내용을 확인해 주세요.');
  if (exceedsChatSize(value)) throw Error(chatLengthError);
  if (value.includes('\0') || !value.isWellFormed()) throw Error('입력한 글에 저장할 수 없는 문자가 있습니다.');
  if (value.trim()) return value;
  if (hasAttachments) return '첨부한 자료를 확인해 주세요.';
  throw Error('보낼 내용을 입력해 주세요.');
}

export const nativeQueueAction = 'Codex 대화 설정으로 보내기';
export const nativeQueueQuestion = '원래 Codex 대화에서 실행할까요?';
export const nativeQueueExplanation = '이 요청은 원래 Codex 대화의 모델, 파일 접근 권한과 승인 설정으로 실행합니다. 실행 중인 작업이 있으면 그 뒤에 이어집니다.';
export const clearQueueAction = '이 기기의 대기 해제';
export const clearQueueQuestion = '이 기기에서 대기를 해제할까요?';
export const clearQueueExplanation = '원래 대화의 접수와 실행 기록을 다시 확인합니다. 두 기록이 모두 없으면 Flowrium에서 이 요청의 대기를 끝냅니다. 원래 대화와 그 작업은 유지됩니다.';
export function nativeQueueNotice(result) {
  if(result.nativeDelivery==='uncertain'||result.nativeDelivery==='submitting')return '원래 대화의 접수 여부를 확인하고 있습니다.';
  return result.queued ? '원래 Codex 대기열에 접수됐습니다.' : '원래 Codex 대화에 요청을 전달했습니다.';
}

export function queuedInputView(item) {
  const pending = item.status === 'queued';
  const remote = pending && item.nativeDelivery;
  const labels = {submitting:'Codex 접수 중', queued:'Codex에서 실행 대기', uncertain:'Codex 접수 확인 중'};
  const status = item.status==='cancelled' && item.nativeCleared ? '이 기기에서 대기 해제' : remote ? labels[remote] : pending && item.waitingForWriter ? '원래 대화의 쓰기 권한 대기' :
    {queued:'대기 중', sending:'전달 중', sent:'전달함', cancelled:'취소함'}[item.status];
  const hint = remote === 'queued' ? '원래 Codex 대화가 이 요청을 접수했습니다.' :
    remote === 'uncertain' ? '중복 실행을 방지하기 위해 원래 대화의 수신 기록을 확인하고 있습니다.' :
    pending && !remote && item.waitingForWriter ? 'Flowrium 설정으로 실행하려면 원래 대화의 쓰기 권한이 돌아올 때까지 기다려 주세요.' : '';
  return {status, hint, canSendToCodex:pending && !remote && !item.error && item.waitingForWriter === true && item.nativeQueueAvailable === true,
    canCancel:pending && (!remote || remote === 'queued'), canResume:pending && !remote, canClear:remote === 'uncertain'};
}
