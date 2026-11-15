const dialog = document.querySelector('#install-guide');
const guideTitle = dialog.querySelector('#guide-title');
const guideClose = dialog.querySelector('[data-close]');
const help = dialog.querySelector('[data-help]');
const installDetails = dialog.querySelector('[data-install-details]');
let currentGuide;
const nativeInstall = dialog.querySelector('[data-install]');
const instructions = dialog.querySelector('[data-guide]');
const installedMode = matchMedia('(display-mode: standalone)');
let promptEvent;
let installed = false;

function standalone() { return Boolean(installed || installedMode.matches || navigator.standalone); }

function refreshGuide() {
  nativeInstall.hidden = !promptEvent || standalone();
  if (standalone()) {
    instructions.textContent = '지금 홈 화면에 추가한 Flowrium을 사용하고 있습니다.';
  } else if (promptEvent) {
    instructions.textContent = '앱 설치를 선택하면 이 기기의 홈 화면에서 바로 열 수 있습니다.';
  } else if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    instructions.textContent = 'Safari에서 공유를 누르고 ‘홈 화면에 추가’를 선택하세요. ‘웹 앱으로 열기’가 보이면 켠 뒤 추가하세요.';
  } else {
    instructions.textContent = '브라우저 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택하세요. 항목이 없으면 이 주소를 Chrome 또는 Safari에서 열어 주세요.';
  }
}

function openGuide(kind) {
  currentGuide = kind;
  const installing = kind === 'install';
  guideTitle.textContent = installing ? '홈 화면에 설치' : '도움말';
  guideClose.setAttribute('aria-label', installing ? '설치 안내 닫기' : '도움말 닫기');
  help.hidden = installing;
  installDetails.hidden = !installing;
  refreshGuide();
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
guideClose.addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  if (dialog.open || !currentGuide) return;
  document.querySelector('[data-settings-guide="' + currentGuide + '"]')?.focus({preventScroll: true});
  currentGuide = undefined;
});
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  promptEvent = event;
  refreshGuide();
});
window.addEventListener('appinstalled', () => {
  installed = true;
  promptEvent = undefined;
  refreshGuide();
  document.dispatchEvent(new Event('flowrium-install-state'));
  if (dialog.open && currentGuide === 'install') dialog.close();
});
installedMode.addEventListener('change', () => {
  refreshGuide();
  document.dispatchEvent(new Event('flowrium-install-state'));
});
nativeInstall.addEventListener('click', async () => {
  const event = promptEvent;
  if (!event) return;
  promptEvent = undefined;
  nativeInstall.disabled = true;
  try {
    await event.prompt();
    const choice = await event.userChoice;
    if (choice?.outcome === 'accepted' && dialog.open) dialog.close();
  } catch {
    // 브라우저가 설치 요청을 거절하면 같은 창에 수동 설치 경로를 표시합니다.
  } finally {
    nativeInstall.disabled = false;
    refreshGuide();
  }
});
refreshGuide();

export function settingsGuides() {
  const group = document.createElement('section');
  group.className = 'settings-block settings-guides';
  group.setAttribute('aria-label', '사용 안내');
  const title = document.createElement('h2');
  title.textContent = '사용 안내';
  group.append(title);
  for (const [kind, label] of [['help','도움말'],['install','홈 화면에 설치']]) {
    const row = document.createElement('button');
    row.type = 'button';
    row.setAttribute('aria-haspopup', 'dialog');
    row.dataset.settingsGuide = kind;
    row.append(document.createTextNode(label));
    if (kind === 'install' && standalone()) {
      const status = document.createElement('small');
      status.textContent = '설치됨';
      row.append(status);
    }
    const arrow = document.createElement('span');
    arrow.textContent = '›';
    arrow.setAttribute('aria-hidden', 'true');
    row.append(arrow);
    row.addEventListener('click', () => openGuide(kind));
    group.append(row);
  }
  return group;
}

export function reconnectForm() {
  const form = document.createElement('form');
  form.className = 'reconnect-form';
  const label = document.createElement('label');
  label.textContent = '연결 주소 붙여넣기';
  const input = document.createElement('input');
  input.type = 'password';
  input.inputMode = 'url';
  input.autocomplete = 'off';
  input.autocapitalize = 'none';
  input.spellcheck = false;
  input.required = true;
  input.maxLength = 2048;
  label.append(input);
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = '이 기기에서 연결';
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.hidden = true;
  form.append(label, button, message);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const address = input.value.trim();
    input.value = '';
    try {
      const url = new URL(address);
      if (url.origin !== location.origin) throw Error('데스크톱 연결을 다시 켜면 주소가 바뀔 수 있습니다. 받은 새 주소를 브라우저에서 직접 열고 홈 화면에 다시 추가하세요.');
      if (url.username || url.password || url.pathname !== '/' || url.search || !/^#(?:key|handoff)=[\w-]{43}$/.test(url.hash))
        throw Error('데스크톱 설정에서 복사한 전체 연결 주소를 붙여넣으세요.');
      // 비밀값을 쿼리나 설치 주소에 넣지 않고 현재 출처의 기존 로그인 절차로 넘깁니다.
      history.replaceState(null, '', '/' + url.hash);
      location.reload();
    } catch (error) {
      message.textContent = error instanceof TypeError ? '올바른 연결 주소를 붙여넣으세요.' : error.message;
      message.hidden = false;
      input.focus();
    }
  });
  return form;
}
