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
