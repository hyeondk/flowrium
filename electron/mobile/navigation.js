const nav = document.querySelector('#nav');
const buttons = [...nav.querySelectorAll('button')];
const viewport = window.visualViewport;
const keyboardField = 'textarea,input:not([type=button]):not([type=checkbox]):not([type=radio]):not([readonly]),[contenteditable=true]';
let restingHeight = viewport?.height ?? innerHeight;
function updateKeyboard() {
  const editing = document.activeElement?.matches(keyboardField);
  const current = viewport?.height ?? innerHeight;
  if (!editing) restingHeight = current;
  const open = editing && current + 120 < Math.max(innerHeight, restingHeight) && (viewport?.scale ?? 1) === 1;
  document.documentElement.toggleAttribute('data-mobile-keyboard', Boolean(open));
}
viewport?.addEventListener('resize', updateKeyboard);
window.addEventListener('resize', updateKeyboard);
document.addEventListener('focusin', updateKeyboard);
document.addEventListener('focusout', () => requestAnimationFrame(updateKeyboard));

let drag;
let suppressClick = false;
const indexAt = x => {
  const first = buttons[0].getBoundingClientRect();
  return Math.max(0, Math.min(buttons.length - 1, Math.floor((x - first.left) / first.width)));
};
nav.addEventListener('pointerdown', event => {
  suppressClick = false;
  if (!event.isPrimary || event.button !== 0 || !event.target.closest('button')) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
});
nav.addEventListener('pointermove', event => {
  if (drag?.id !== event.pointerId) return;
  const dx = Math.abs(event.clientX - drag.x), dy = Math.abs(event.clientY - drag.y);
  if (!drag.moved && (dx < 10 || dx < dy)) return;
  if (!drag.moved) nav.setPointerCapture(event.pointerId);
  drag.moved = true;
  nav.dataset.preview = String(indexAt(event.clientX));
});
nav.addEventListener('pointerup', event => {
  if (drag?.id !== event.pointerId) return;
  const moved = drag.moved;
  drag = undefined;
  delete nav.dataset.preview;
  if (moved) {
    buttons[indexAt(event.clientX)].click();
    suppressClick = true;
  }
});
function cancelDrag() { drag = undefined; delete nav.dataset.preview; }
nav.addEventListener('pointercancel', cancelDrag);
nav.addEventListener('lostpointercapture', cancelDrag);
nav.addEventListener('click', event => {
  if (suppressClick && event.detail) { event.preventDefault(); event.stopImmediatePropagation(); }
  suppressClick = false;
}, true);
nav.addEventListener('keydown', event => {
  const index = buttons.indexOf(document.activeElement);
  if (index < 0 || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus();
  buttons[next].click();
});
