// Keep the native field for typing, accessibility and form validation.
const fieldSelector = 'input[type=date],input[type=datetime-local]';
const iso = d => [String(d.getFullYear()).padStart(4, '0'), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
const asDate = s => new Date(s + 'T12:00:00');
const shiftDay = (d, amount) => { const next = new Date(d); next.setDate(next.getDate() + amount); return next; };

function element(tag, text, className) {
  const item = document.createElement(tag);
  if (text) item.textContent = text;
  if (className) item.className = className;
  return item;
}

export function installDatePicker() {
  let modal;
  function open(field) {
    if (modal || field.disabled || field.readOnly || field.matches(':disabled')) return;
    const lower = field.min.slice(0,10) || '0001-01-01';
    const upper = field.max.slice(0,10) || '9999-12-31';
    if (lower > upper) return;
    const clamp = day => day < lower ? lower : day > upper ? upper : day;
    const today = iso(new Date());
    let current = asDate(clamp(field.value.slice(0,10) || today));
    let chosen = iso(current);
    const dialog = element('dialog', '', 'flow-date-picker');
    modal = dialog;
    dialog.setAttribute('aria-label', '날짜 선택');
    const header = element('header'), title = element('strong');
    const grid = element('div', '', 'flow-date-days');
    const weeks = element('div', '', 'flow-date-week');
    for (const day of ['일','월','화','수','목','금','토']) weeks.append(element('span',day));
    const time = field.type === 'datetime-local' ? element('input') : null;
    const bottom = element('footer');
    function button(text, label, onClick) {
      const b = element('button', text); b.type = 'button';
      b.setAttribute('aria-label', label); b.onclick = onClick; return b;
    }
    function finish(value) {
      if (value !== undefined && field.isConnected && !field.matches(':disabled') && !field.readOnly) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(field, value);
        field.dispatchEvent(new Event('input',{bubbles:true}));
        field.dispatchEvent(new Event('change',{bubbles:true}));
      }
      dialog.close();
    }
    function moveMonth(amount) {
      const next = new Date(current);
      next.setDate(1); next.setMonth(next.getMonth()+amount);
      const end = new Date(next); end.setMonth(end.getMonth()+1,0);
      next.setDate(Math.min(current.getDate(),end.getDate()));
      if (next.getFullYear()<1 || next.getFullYear()>9999) return;
      current = asDate(clamp(iso(next))); render(true);
    }
    function select(day) {
      chosen = day;
      if (!time) finish(day); else { current = asDate(day); render(true); }
    }
    const prev = button('‹', '이전 달', () => moveMonth(-1));
    const next = button('›', '다음 달', () => moveMonth(1));
    header.append(prev, title, next);
    dialog.append(header, weeks, grid);
    let timeSave;
    if (time) {
      const label = element('label','시각'); time.type = 'time';
      time.value = field.value.split('T')[1] || '09:00';
      label.append(time); dialog.append(label);
      timeSave = button('적용','선택한 날짜와 시각 적용',()=>finish(chosen+'T'+time.value));
      time.addEventListener('input',updateTime);
    }
    function updateTime() {
      if (!time) return;
      time.min = field.min.startsWith(chosen+'T') ? field.min.split('T')[1] : '';
      time.max = field.max.startsWith(chosen+'T') ? field.max.split('T')[1] : '';
      timeSave.disabled = !time.value || !time.validity.valid;
    }
    const todayButton = button('오늘','오늘 날짜 선택',()=>select(today));
    todayButton.disabled=today<lower||today>upper;
    bottom.append(todayButton);
    if (!field.required) bottom.append(button('지우기','날짜 지우기',()=>finish('')));
    bottom.append(button('닫기','날짜 선택 닫기',()=>finish()));
    if (timeSave) bottom.append(timeSave);
    dialog.append(bottom);
    function render(focus) {
      title.textContent=current.getFullYear()+'년 '+(current.getMonth()+1)+'월';
      const first=new Date(current); first.setDate(1);
      const cursor=new Date(first);
      prev.disabled=iso(first).slice(0,7)<=lower.slice(0,7);
      next.disabled=iso(first).slice(0,7)>=upper.slice(0,7);
      grid.replaceChildren();
      for (let i=0; i<first.getDay(); i++) grid.append(element('span'));
      while (cursor.getMonth()===first.getMonth()) {
        const key=iso(cursor), b=button(String(cursor.getDate()), key, ()=>select(key));
        b.dataset.day=key; b.disabled=key<lower||key>upper;
        b.tabIndex=key===iso(current)?0:-1; b.setAttribute('aria-pressed',String(key===chosen));
        if (key===today) b.setAttribute('aria-current','date');
        grid.append(b); cursor.setDate(cursor.getDate()+1);
      }
      updateTime();
      if (focus) grid.querySelector('button[tabindex="0"]')?.focus();
    }
    dialog.addEventListener('keydown', e=>{
      if (e.key==='Escape') { e.preventDefault(); e.stopPropagation(); finish(); return; }
      if (!grid.contains(e.target)) return;
      const days={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-current.getDay(),End:6-current.getDay()};
      if (Object.hasOwn(days,e.key)) {
        e.preventDefault(); current=asDate(clamp(iso(shiftDay(current,days[e.key])))); render(true);
      } else if (e.key==='PageUp'||e.key==='PageDown') {
        e.preventDefault(); moveMonth((e.key==='PageUp'?-1:1)*(e.shiftKey?12:1));
      }
    });
    dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)finish();}});
    dialog.addEventListener('close',()=>{modal=null;dialog.remove();if(field.isConnected) field.focus({preventScroll:true});},{once:true});
    document.body.append(dialog); render(false); dialog.showModal(); grid.querySelector('button[tabindex="0"]')?.focus();
  }
  document.addEventListener('pointerdown',e=>{
    if(e.button===0 && e.target.matches?.(fieldSelector) && !e.target.readOnly) e.preventDefault();
  },true);
  document.addEventListener('click', e=>{
    if (e.target.matches?.(fieldSelector)) {e.preventDefault();open(e.target);}
  },true);
  document.addEventListener('keydown', e=>{
    if (e.target.matches?.(fieldSelector) && (e.key===' '||e.key==='F4'||e.key==='Enter'||(e.altKey && e.key==='ArrowDown'))) {
      e.preventDefault();open(e.target);
    }
  });
}
