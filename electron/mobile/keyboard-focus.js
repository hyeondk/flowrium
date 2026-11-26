export function installKeyboardFocus() {
  const root = document.documentElement;
  document.addEventListener('pointerdown', () => {
    delete root.dataset.keyboardFocus;
  }, true);
  document.addEventListener('keydown', event => {
    if (!event.isComposing && !event.metaKey && !event.altKey && !event.ctrlKey &&
        (event.key === 'Tab' || event.key.startsWith('Arrow'))) {
      root.dataset.keyboardFocus = '';
    }
  }, true);
}
