const FILE_ERRORS = {
  ENOENT: "파일이나 폴더를 찾을 수 없습니다. 경로를 확인해 주세요.",
  EACCES: "파일에 접근할 권한이 없습니다. 폴더 권한을 확인해 주세요.",
  EPERM: "이 작업을 수행할 권한이 없습니다. 접근 권한을 확인해 주세요.",
  ENOSPC: "저장 공간이 부족합니다. 여유 공간을 확보한 뒤 다시 시도해 주세요.",
  EROFS: "읽기 전용 위치에는 저장할 수 없습니다.",
  EISDIR: "파일 대신 폴더가 지정됐습니다. 저장 경로를 확인해 주세요.",
  ENOTDIR: "폴더 경로가 올바르지 않습니다.",
  EBUSY: "파일이 사용 중입니다. 잠시 후 다시 시도해 주세요.",
  ENAMETOOLONG: "파일 경로가 너무 깁니다. 더 짧은 경로를 선택해 주세요.",
};
function publicMessage(
  error,
  fallback = "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
) {
  if (FILE_ERRORS[error?.code]) return FILE_ERRORS[error.code];
  if (error instanceof SyntaxError)
    return "저장된 자료의 형식이 올바르지 않습니다.";
  const message = typeof error?.message === "string" ? error.message : "";
  return /[가-힣]/u.test(message) ? message : fallback;
}

function chatFailure(error, fallback = 'Codex가 작업을 마치지 못했고 구체적인 원인을 보내지 않았습니다. 작업 상태를 확인한 뒤 다시 시도해 주세요.') {
  const received = typeof error === 'string' ? error : error?.rpcMessage || error?.message;
  const message = typeof received === 'string' ? received : '';
  const info = error?.codexErrorInfo;
  const kind = (typeof info === 'string' ? info : Object.keys(info || {})[0] || '').toLowerCase();
  const detail = typeof info === 'object' && info !== null ? Object.values(info)[0] : undefined;
  const status = Number(detail?.httpStatusCode ?? error?.statusCode ?? /\b(?:HTTP(?: status)?|unexpected status|status(?: code)?)\D{0,6}(\d{3})\b/i.exec(message)?.[1]);
  const known = (reason, summary) => ({reason, message:summary});

  if (error?.code === 'CODEX_EXECUTABLE_MISSING' || /Codex 실행 파일을 찾지 못했습니다/.test(message))
    return known('unavailable','이 기기에서 Codex 실행 파일을 찾지 못했습니다. Flowrium을 다시 설치하거나 설정에서 Codex 실행 파일 경로를 확인해 주세요.');
  if (error?.code === 'CODEX_START' || /Codex를 실행하지 못했습니다/.test(message))
    return known('unavailable','Codex 실행 파일을 열지 못했습니다. 실행 권한과 보안 프로그램의 차단 여부를 확인해 주세요.');
  if (error?.code === 'PROTOCOL_FRAME_TOO_LARGE' || /Codex 응답.*(?:초과|한도)/.test(message))
    return known('response-size','Codex에서 받은 데이터 한 건이 수신 한도를 넘었습니다. 대화를 새로고침한 뒤 이어서 요청해 주세요.');
  if (error?.code === 'RPC_TIMEOUT' || /timed? ?out|deadline exceeded|요청 시간이 초과/.test(message.toLowerCase()))
    return known('timeout','Codex가 정해진 시간 안에 응답하지 않았습니다. 네트워크와 Codex 연결 상태를 확인해 주세요.');
  if (status === 401 || kind === 'unauthorized' || /(?:token|session).{0,40}(?:expired|revok)|unauthorized|invalid bearer|invalid_grant/i.test(message))
    return known('login','ChatGPT 로그인 인증이 만료됐거나 거부됐습니다. Flowrium에서 ChatGPT 계정으로 다시 로그인해 주세요.');
  if (/failed to (?:re)?load workspace requirements:/i.test(message))
    return known('workspace-config','Codex가 ChatGPT 작업 공간 설정을 불러오지 못했습니다. Flowrium을 업데이트하고 대화를 다시 연 뒤 보내 주세요.');
  if (status === 402 || kind === 'usagelimitexceeded' || /usage.?limit|insufficient.?quota|quota exceeded|out of credits|usage cap/i.test(message))
    return known('usage','계정의 사용 한도 또는 크레딧을 모두 사용했습니다. 설정에서 남은 사용량과 초기화 시각을 확인해 주세요.');
  if (kind === 'sessionbudgetexceeded')
    return known('session-budget','이 대화에서 사용할 수 있는 모델 한도에 도달했습니다. 새 대화에서 요청을 이어가 주세요.');
  if (kind === 'flexunavailable')
    return known('speed','선택한 실행 속도를 현재 사용할 수 없습니다. 표준 속도로 다시 보내 주세요.');
  if (status === 429 || ['ratelimitexceeded','policycapacityunavailable'].includes(kind) || /rate.?limit|too many requests|overload|try again later/i.test(message))
    return known('rate','서버가 현재 요청을 한꺼번에 처리할 수 없습니다. 잠시 뒤 다시 보내 주세요.');
  if (kind === 'contextwindowexceeded' || /context.?window|context_length_exceeded|maximum context|too many tokens/i.test(message))
    return known('context','요청과 대화 기록이 모델의 문맥 한도를 넘었습니다. 대화 설정에서 문맥을 정리하거나 요청을 나누어 보내 주세요.');
  if (/windows sandbox|sandbox.*(?:setup|elevat|access denied)/i.test(message) || kind === 'sandboxerror' && process.platform === 'win32')
    return known('permission','윈도우에서 Codex 작업용 샌드박스를 시작하지 못했습니다. 윈도우 보안 정책과 프로젝트 폴더 접근 권한을 확인해 주세요.');
  if (kind === 'sandboxerror' || kind === 'toomanydenials')
    return known('permission','Codex 작업에 필요한 접근이나 실행이 제한됐습니다. 작업 범위와 권한을 확인해 주세요.');
  if (status === 403 || /forbidden|permission.?denied|access.{0,12}denied/i.test(message))
    return known('permission','이 계정이나 작업 공간에 요청을 실행할 권한이 없습니다. 계정과 프로젝트 접근 권한을 확인해 주세요.');
  if (error?.code === 'THREAD_WRITER_BUSY' || kind === 'activeturnnotsteerable' || /thread (?:is |already )?(?:active|busy|in use)|another (?:client|process)|active turn/i.test(message))
    return known('busy','다른 앱에서 같은 대화를 실행하고 있습니다. 현재 작업이 끝나면 이어서 보내거나, 추가 지시에서 분기해 실행할 수 있습니다.');
  if (/missing (?:field )?[`'\"]?threadId/i.test(message))
    return known('thread','전송 요청에 대화 식별자가 빠져 Codex가 작업을 시작하지 못했습니다. 대화를 새로고침한 뒤 다시 보내 주세요.');
  if (kind === 'threadrollbackfailed' || /thread.{0,20}(?:not found|does not exist)|no rollout/i.test(message))
    return known('thread','Codex에서 연결된 대화를 찾지 못했습니다. 대화를 새로고침하고 원본 연결을 확인해 주세요.');
  if (kind === 'modelnotfound' || /model.{0,80}(?:not found|does not exist|not (?:available|supported)|does not support)|unsupported model/i.test(message))
    return known('model','이 계정에서 선택한 모델을 사용할 수 없습니다. 다른 모델을 선택해 주세요.');
  if (['badrequest','invalidrequest'].includes(kind) || error?.rpcCode === -32602 || /invalid (?:request|param)|missing field/i.test(message))
    return known('request','Codex가 요청 형식을 받아들이지 못했습니다. 최신 Flowrium에서 대화를 새로고침한 뒤 다시 시도해 주세요.');
  if (['cyberpolicy','misalignmentpolicyviolation'].includes(kind))
    return known('policy','Codex의 안전 검사에서 요청 처리를 중단했습니다. 요청 내용을 확인해 주세요.');
  if (status >= 500 || ['serveroverloaded','internalservererror'].includes(kind))
    return known('server','OpenAI 서버에서 요청을 처리하지 못했습니다. 잠시 뒤 다시 보내 주세요.');
  if (/Codex 연결(?:이 종료|을 종료)/u.test(message))
    return known('connection','Codex 연결이 종료됐습니다. Flowrium의 연결을 다시 확인해 주세요.');
  if (['httpconnectionfailed','responsestreamconnectionfailed','responsestreamdisconnected','responsetoomanyfailedattempts'].includes(kind) || /(?:econnreset|econnrefused|enotfound|eai_again|dns|tls|network|fetch failed|error sending request|websocket)/i.test(`${error?.code || ''} ${message}`) || /disconnect|connection (?:closed|lost)|Codex 연결이 없/i.test(message))
    return known('connection','Codex 연결이 끊겼습니다. 네트워크나 방화벽을 확인하고 Flowrium에서 다시 연결해 주세요.');
  if (FILE_ERRORS[error?.code]) return known('file',FILE_ERRORS[error.code]);
  if (/[가-힣]/u.test(message) && !/^(?:Codex 요청을 처리하지 못했습니다\.|작업을 완료하지 못했습니다\.)\s+[a-z]/i.test(message))
    return known('other',message);
  return known('other',fallback);
}

module.exports = { publicMessage, chatFailure };
