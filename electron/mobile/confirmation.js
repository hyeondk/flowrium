const sheet = document.querySelector('#confirmation-sheet');
const title = sheet.querySelector('h2');
const detail = sheet.querySelector('p');
const cancel = sheet.querySelector('[data-cancel]');
const accept = sheet.querySelector('[data-accept]');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let pending, closeTimer;

function currentTrigger() {
  return pending && document.querySelector('[data-confirm-action="' + CSS.escape(pending.id) + '"]');
}

function finishClose() {
  clearTimeout(closeTimer);
  if (!sheet.open) return;
  const trigger = currentTrigger();
  pending = undefined;
  sheet.close();
  delete sheet.dataset.phase;
  title.textContent = detail.textContent = '';
  const next = trigger && !trigger.disabled ? trigger : document.querySelector('#content');
  next?.focus({preventScroll:true});
}

function close(confirmed = false) {
  if (!pending || sheet.dataset.phase === 'exit') return;
  const trigger = currentTrigger();
  const execute = confirmed && trigger && !trigger.disabled ? pending.execute : undefined;
  sheet.dataset.phase = 'exit';
  if (reduced.matches) finishClose();
  else closeTimer = setTimeout(finishClose, 260);
  execute?.();
}

export function confirmationButton(label, id, heading, description, execute) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.confirmAction = id;
  button.setAttribute('aria-haspopup', 'dialog');
  button.addEventListener('click', () => {
    if (sheet.open) return;
    pending = {id:button.dataset.confirmAction, execute};
    title.textContent = heading;
    detail.textContent = typeof description === 'function' ? description() : description;
    // An informational sheet can be dismissed, but cannot grant permission.
    accept.hidden = !execute;
    cancel.textContent = execute ? '취소' : '닫기';
    accept.textContent = label;
    sheet.dataset.phase = 'enter';
    sheet.showModal();
    cancel.focus({preventScroll:true});
  });
  return button;
}

// Polling replaces the underlying controls, even while a dialog is open.
// Never apply an old confirmation after the action disappears or the app locks.
export function reconcileConfirmation(locked) {
  if (sheet.open && (locked || (sheet.dataset.phase !== 'exit' && !currentTrigger()))) finishClose();
}

cancel.addEventListener('click', () => close());
accept.addEventListener('click', () => close(true));
sheet.addEventListener('cancel', event => { event.preventDefault(); close(); });
sheet.addEventListener('transitionend', event => {
  if(event.target===sheet && !event.pseudoElement && event.propertyName==='transform' && sheet.dataset.phase==='exit')finishClose();
});
function outside(event) {
  const box = sheet.getBoundingClientRect();
  return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
}
let backdropPress = false;
sheet.addEventListener('pointerdown', event => { backdropPress = event.isPrimary && outside(event); });
sheet.addEventListener('pointercancel', () => { backdropPress = false; });
sheet.addEventListener('click', event => {
  if (backdropPress && event.target === sheet && outside(event)) close();
  backdropPress = false;
});
