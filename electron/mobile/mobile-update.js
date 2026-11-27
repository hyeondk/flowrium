import {confirmationButton} from './confirmation.js';
import {emphasizeAction} from './mobile-action.js';

const versionStamp = document.querySelector('meta[name="flowrium-mobile-version"]')?.content;
const returnFlag = 'flowrium.mobile.updated';
let fallbackVersion, result, phase = '', failure = '', generation = 0;

export function resumeUpdateSettings() {
  try {
    const value = sessionStorage.getItem(returnFlag);
    sessionStorage.removeItem(returnFlag);
    return Boolean(value);
  } catch { return false; }
}

export function resetUpdate() {
  generation++;
  result = undefined;
  phase = failure = '';
}

export function mobileUpdateSection({data, call, refresh, onError, hasDrafts, canReload}) {
  const el = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const control = (text, callback, id) => {
    const button = el('button',text);
    button.type = 'button';
    button.dataset.settingsGuide = id;
    button.addEventListener('click',callback);
    button.disabled = Boolean(phase);
    return button;
  };
  fallbackVersion ||= data.mobileVersion || data.version;
  const openedVersion = versionStamp || fallbackVersion;
  const observed = data.mobileVersion || data.version;
  const hostedVersion = result?.version > observed ? result.version : observed;
  const ready = hostedVersion !== openedVersion;
  const available = result?.status === 'available' && result.latestVersion > hostedVersion;
  const message = failure || ({
    checking:'공개된 최신 버전을 확인하고 있습니다.',
    applying:'모바일 화면 파일을 확인하고 적용하고 있습니다.',
  })[phase] || (available ? '새 버전 ' + result.latestVersion + '을 사용할 수 있습니다.'
    : ready ? '업데이트된 화면을 열 수 있습니다.'
    : result?.status === 'desktop-required' ? result.latestVersion + '을 사용하려면 컴퓨터의 Flowrium부터 업데이트한 뒤 새 QR 코드로 연결하세요.'
    : result?.status === 'current' ? '최신 버전을 사용하고 있습니다.' : '');

  const section = el('section', '', 'settings-block mobile-update');
  section.setAttribute('aria-label','앱 업데이트');
  const versionLine = el('div','','mobile-update-version-line');
  const currentVersion = el('p','현재 버전 ' + openedVersion,'mobile-current-version');
  const check = control('업데이트 확인',() => run('checking', () => call('checkMobileUpdate')), 'check-mobile-version');
  emphasizeAction(check,'refresh');
  versionLine.append(currentVersion,check);
  section.append(el('h2','앱 버전 및 업데이트'),versionLine);
  if (message) {
    const status = el('p', message,'hint');
    status.setAttribute('role','status');
    section.append(status);
  }
  async function run(nextPhase, task) {
    if (phase) return;
    const epoch = generation;
    phase = nextPhase;
    failure = '';
    refresh();
    try {
      const value = await task();
      if (epoch !== generation) return false;
      result = value;
      return true;
    } catch (error) {
      if (epoch === generation) {
        if (error.gate) onError(error.gate);
        else failure = '업데이트를 완료하지 못했습니다. ' +
          (/[가-힣]/.test(error.message) ? error.message : '연결 상태를 확인하고 다시 시도하세요.');
      }
      return false;
    } finally {
      if (epoch === generation) { phase = ''; refresh(); }
    }
  }
  function reload() {
    try { sessionStorage.setItem(returnFlag,'1'); } catch {}
    location.reload();
  }
  async function apply(discardConfirmed) {
    if (available && !await run('applying', () => call('applyMobileUpdate',result.latestVersion))) return;
    // A user can move to a conversation and type while the download runs.
    if (canReload() && (discardConfirmed || !hasDrafts())) reload();
  }
  if (available || ready) {
    const applyButton = hasDrafts()
      ? confirmationButton('업데이트 적용','mobile-ui-update','새 화면을 열까요?',
          '전송하지 않은 입력과 저장하지 않은 편집 내용이 닫힙니다. 먼저 마치려면 취소하세요.', () => apply(true))
      : control('업데이트 적용', () => apply(false), 'apply-mobile-version');
    applyButton.disabled = Boolean(phase);
    applyButton.classList.add('main-action');
    emphasizeAction(applyButton,'download');
    const buttons = el('div','','mobile-update-actions');
    buttons.append(applyButton);
    section.append(buttons);
  }
  return section;
}
