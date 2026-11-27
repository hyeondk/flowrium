export function installKeyboardFocus() {
  const root = document.documentElement;
  document.addEventListener('pointerdown', event => {
    delete root.dataset.keyboardFocus;
    root.toggleAttribute('data-touch-input',event.pointerType==='touch');
  }, true);
  document.addEventListener('pointermove',event=>{
    if(event.pointerType==='mouse'&&root.hasAttribute('data-touch-input'))root.removeAttribute('data-touch-input');
  },{capture:true,passive:true});
  document.addEventListener('keydown', event => {
    if (!event.isComposing && !event.metaKey && !event.altKey && !event.ctrlKey &&
        (event.key === 'Tab' || event.key.startsWith('Arrow'))) {
      root.dataset.keyboardFocus = '';
    }
  }, true);
}
