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

// A normal-width bar scrubs through tabs. With enlarged text, leave room for
// each label and let the browser pan through the row without changing screens.
const overflowing = () => nav.scrollWidth > nav.clientWidth + 1;
const selected = () => buttons.find(button => button.getAttribute('aria-current') === 'page');
const clampTab = value => Math.max(0, Math.min(buttons.length - 1, value));

function reveal(button) {
  if (!button || !overflowing()) return;
  const bounds = nav.getBoundingClientRect(), tab = button.getBoundingClientRect();
  const inset = nav.clientLeft + parseFloat(getComputedStyle(nav).paddingLeft);
  const shift = Math.min(0, tab.left - bounds.left - inset) + Math.max(0, tab.right - bounds.right + inset);
  if (shift) nav.scrollBy({left:shift, behavior:'instant'});
}
const sizeObserver = new ResizeObserver(() => {
  const needsScroll = overflowing();
  nav.toggleAttribute('data-overflow', needsScroll);
  if (needsScroll) reveal(selected());
});
sizeObserver.observe(nav);
sizeObserver.observe(buttons[0]);
let lastSelected;
new MutationObserver(() => {
  const current = selected();
  if (current !== lastSelected) reveal(current);
  lastSelected = current;
}).observe(nav, {subtree:true, attributes:true, attributeFilter:['aria-current']});

let drag;
let suppressClick = false;
function clearDrag() {
  drag = undefined;
  delete nav.dataset.dragging;
  nav.style.removeProperty('--nav-preview');
  nav.querySelector('[data-drag-target]')?.removeAttribute('data-drag-target');
}
function fingerPosition(x) {
  const first = buttons[0].getBoundingClientRect();
  const pitch = buttons[1].getBoundingClientRect().left - first.left;
  return clampTab((x - first.left - first.width / 2) / pitch);
}
nav.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0 || !event.target.closest('button')) return;
  suppressClick = false;
  if (overflowing() && event.pointerType !== 'mouse') return;
  drag = {id:event.pointerId, x:event.clientX, y:event.clientY, scroll:nav.scrollLeft, pan:overflowing()};
});
document.addEventListener('pointermove', event => {
  if (drag?.id !== event.pointerId) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (!drag.moved) {
    if (Math.abs(dy) >= 8 && Math.abs(dy) > Math.abs(dx)) {
      suppressClick = true;
      clearDrag();
      return;
    }
    if (Math.abs(dx) < 8) return;
    drag.moved = true;
    nav.setPointerCapture(event.pointerId);
    nav.dataset.dragging = '';
  }
  if (drag.pan) nav.scrollLeft = drag.scroll - dx;
  else {
    const position = fingerPosition(event.clientX);
    nav.style.setProperty('--nav-preview', String(position));
    const target = buttons[Math.round(position)];
    if (!target.hasAttribute('data-drag-target')) {
      nav.querySelector('[data-drag-target]')?.removeAttribute('data-drag-target');
      target.setAttribute('data-drag-target','');
    }
  }
});
document.addEventListener('pointerup', event => {
  if (drag?.id !== event.pointerId) return;
  const {moved, pan} = drag;
  clearDrag();
  if (!moved) return;
  suppressClick = true;
  if (!pan) buttons[Math.round(fingerPosition(event.clientX))].click();
});
document.addEventListener('pointercancel', event => {
  if (drag?.id === event.pointerId) clearDrag();
});
nav.addEventListener('lostpointercapture', event => {
  if (event.target === nav && drag?.id === event.pointerId) clearDrag();
});
window.addEventListener('blur', clearDrag);
nav.addEventListener('click', event => {
  if (suppressClick && event.detail) {
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClick = false;
  }
}, true);

// Consume one deliberate horizontal trackpad gesture, including its momentum.
let lastWheel = -Infinity, wheelDistance = 0, wheelCommitted = false;
nav.addEventListener('wheel', event => {
  if (event.ctrlKey || event.metaKey || overflowing()) return;
  const horizontal = event.deltaX || (event.shiftKey ? event.deltaY : 0);
  if (!horizontal || (!event.shiftKey && Math.abs(horizontal) <= Math.abs(event.deltaY))) return;
  event.preventDefault();
  // Delivery can wait for rendering. Group by input time, not handler time.
  const now = event.timeStamp;
  if (now - lastWheel > 180) { wheelDistance = 0; wheelCommitted = false; }
  lastWheel = now;
  if (wheelCommitted) return;
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? nav.clientWidth : 1;
  wheelDistance += horizontal * unit;
  if (Math.abs(wheelDistance) < 28) return;
  wheelCommitted = true;
  const index = buttons.indexOf(selected());
  const next = clampTab(index + Math.sign(wheelDistance));
  if (index >= 0 && index !== next) buttons[next].click();
}, {passive:false});
nav.addEventListener('keydown', event => {
  const index = buttons.indexOf(document.activeElement);
  if (index < 0 || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus();
  buttons[next].click();
});
