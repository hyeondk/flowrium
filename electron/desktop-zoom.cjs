// 데스크톱 문서의 기준 배율. 휴대폰 원격 화면의 CSS 배율과 분리한다.
const DEFAULT_DESKTOP_ZOOM = 0.87;
function initializeDesktopZoom(contents) {
  // 저장된 Chromium 원점 배율보다 새 창의 기준을 우선하되, 이후의 새로고침이나
  // 사용자가 고른 확대 배율은 다시 덮어쓰지 않는다.
  contents.once('did-finish-load', () => {
    if (!contents.isDestroyed()) contents.setZoomFactor(DEFAULT_DESKTOP_ZOOM);
  });
}
function resetDesktopZoom(window) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.setZoomFactor(DEFAULT_DESKTOP_ZOOM);
}
module.exports = {DEFAULT_DESKTOP_ZOOM, initializeDesktopZoom, resetDesktopZoom};
