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
module.exports = { publicMessage };
