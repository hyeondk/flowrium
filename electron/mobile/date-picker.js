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
  let picker;
  function open(field) {
    if (field.disabled || field.readOnly || field.matches(':disabled')) return;
    if (picker?.field === field) { picker.finish(); return; }
    picker?.finish(undefined,false);
    const lower = field.min.slice(0,10) || '0001-01-01';
    const upper = field.max.slice(0,10) || '9999-12-31';
    if (lower > upper) return;
    const clamp = day => day < lower ? lower : day > upper ? upper : day;
    const firstYear = Number(lower.slice(0,4)), lastYear = Number(upper.slice(0,4));
    const today = iso(new Date());
    let current = asDate(clamp(field.value.slice(0,10) || today));
    let chosen = iso(current);
    const dialog = element('dialog', '', 'flow-date-picker');
    const listeners = new AbortController();
    const lifetime = {signal:listeners.signal};
    picker = {field,finish};
    dialog.setAttribute('aria-label', '날짜 선택');
    dialog.id = 'flow-date-picker-popup';
    const previousExpanded = field.getAttribute('aria-expanded'), previousControls = field.getAttribute('aria-controls');
    field.setAttribute('aria-expanded','true');
    field.setAttribute('aria-controls',dialog.id);
    const header = element('header');
    const title = button('', '연도와 달 선택', toggleJump);
    title.className = 'flow-date-title';
    title.setAttribute('aria-expanded','false');
    title.setAttribute('aria-controls','flow-date-months');
    const body = element('div','','flow-date-main');
    const grid = element('div', '', 'flow-date-days');
    const weeks = element('div', '', 'flow-date-week');
    for (const day of ['일','월','화','수','목','금','토']) weeks.append(element('span',day));
    const jump = element('div','','flow-date-jump');
    jump.id = 'flow-date-months';
    jump.hidden = true;
    const year = element('input');
    year.type = 'text'; year.inputMode = 'numeric'; year.maxLength = 4; year.autocomplete = 'off';
    year.setAttribute('aria-label','이동할 연도');
    const yearLabel = element('label','연도', 'flow-date-year');
    yearLabel.append(year);
    const months = element('div','','flow-date-months');
    months.setAttribute('role','group'); months.setAttribute('aria-label','이동할 달');
    const monthButtons = Array.from({length:12}, (_,index)=>{
      const month = index+1;
      const b = button(month+'월',month+'월로 이동',()=>jumpTo(Number(year.value),month));
      months.append(b);
      return b;
    });
    jump.append(yearLabel,months);
    body.append(weeks,grid,jump);
    const time = field.type === 'datetime-local' ? element('input') : null;
    const bottom = element('footer');
    function button(text, label, onClick) {
      const b = element('button', text); b.type = 'button';
      b.setAttribute('aria-label', label); b.onclick = onClick; return b;
    }
    function cleanUp() {
      if (picker?.field !== field || picker.finish !== finish) return;
      picker = undefined;
      listeners.abort();
      cancelAnimationFrame(frame);
      observer.disconnect(); mutations.disconnect();
      for (const [name,previous] of [['aria-expanded',previousExpanded],['aria-controls',previousControls]]) {
        if (previous === null) field.removeAttribute(name); else field.setAttribute(name,previous);
      }
      dialog.remove();
    }
    function finish(value, focus = true) {
      if (picker?.finish !== finish) return;
      if (value !== undefined && field.isConnected && !field.matches(':disabled') && !field.readOnly) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(field, value);
        field.dispatchEvent(new Event('input',{bubbles:true}));
        field.dispatchEvent(new Event('change',{bubbles:true}));
      }
      dialog.close();
      cleanUp();
      // Return keyboard focus as part of this interaction. The native close
      // event can arrive after the user has started typing in another field.
      if (focus && field.isConnected && !field.matches(':disabled')) field.focus({preventScroll:true});
    }
    function monthDate(targetYear,targetMonth) {
      const next = new Date(current);
      next.setDate(1); next.setFullYear(targetYear,targetMonth);
      const end = new Date(next); end.setMonth(end.getMonth()+1,0);
      next.setDate(Math.min(current.getDate(),end.getDate()));
      return next;
    }
    function moveMonth(amount) {
      const next = monthDate(current.getFullYear(),current.getMonth()+amount);
      if (next.getFullYear()<1 || next.getFullYear()>9999) return;
      current = asDate(clamp(iso(next))); render(true);
    }
    function monthAllowed(targetYear,month) {
      if (!Number.isInteger(targetYear) || targetYear<firstYear || targetYear>lastYear) return false;
      const key = String(targetYear).padStart(4,'0')+'-'+String(month).padStart(2,'0');
      return key>=lower.slice(0,7) && key<=upper.slice(0,7);
    }
    function jumpTo(targetYear,month) {
      if (!monthAllowed(targetYear,month)) return;
      current = asDate(clamp(iso(monthDate(targetYear,month-1))));
      toggleJump(); render(true);
    }
    function toggleJump() {
      const show = jump.hidden;
      weeks.hidden = grid.hidden = show;
      jump.hidden = !show;
      title.setAttribute('aria-expanded',String(show));
      if (!show) { render(false); title.focus({preventScroll:true}); return; }
      year.value = String(current.getFullYear());
      renderJump();
      const target = window.matchMedia('(pointer:coarse)').matches ? monthButtons[current.getMonth()] : year;
      target.focus({preventScroll:true});
      if(target===year)year.select();
    }
    function renderJump() {
      const value = Number(year.value);
      prev.disabled = value<=firstYear;
      next.disabled = value>=lastYear;
      prev.setAttribute('aria-label','이전 해'); next.setAttribute('aria-label','다음 해');
      monthButtons.forEach((b,index)=>{
        b.disabled = !monthAllowed(value,index+1);
        b.setAttribute('aria-pressed',String(value===current.getFullYear() && index===current.getMonth()));
      });
    }
    function move(amount) {
      if (jump.hidden) return moveMonth(amount);
      const value = Math.min(lastYear,Math.max(firstYear,(Number(year.value)||current.getFullYear())+amount));
      year.value = String(value); renderJump();
    }
    function select(day) {
      chosen = day;
      if (!time) finish(day); else { current = asDate(day); render(true); }
    }
    const prev = button('‹', '이전 달', () => move(-1));
    const next = button('›', '다음 달', () => move(1));
    header.append(prev, title, next);
    dialog.append(header, body);
    let timeSave;
    if (time) {
      const label = element('label','시각'); time.type = 'time';
      time.value = field.value.split('T')[1] || '09:00';
      if(field.hasAttribute('data-time-parts')){
        const parts=element('div','', 'mobile-time-parts');parts.setAttribute('role','group');parts.setAttribute('aria-label','시각 선택');
        const controls=[['시',24],['분',60]].map(([name,count],i)=>{
          const control=element('select');control.setAttribute('aria-label',name);
          for(let n=0;n<count;n++){const value=String(n).padStart(2,'0'),option=element('option',value+name);option.value=value;control.append(option);}
          control.value=time.value.split(':')[i];parts.append(control);return control;
        });
        parts.addEventListener('change',()=>{time.value=controls.map(control=>control.value).join(':');updateTime();});
        dialog.append(parts);
      }else{label.append(time);dialog.append(label);}
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
    const dismiss = button('닫기','날짜 선택 닫기',()=>finish());
    dismiss.classList.add('popup-close-button');
    bottom.append(dismiss);
    if (timeSave) bottom.append(timeSave);
    dialog.append(bottom);
    function render(focus) {
      title.textContent=current.getFullYear()+'년 '+(current.getMonth()+1)+'월';
      title.setAttribute('aria-label',title.textContent+' / 연도와 달 선택');
      const first=new Date(current); first.setDate(1);
      prev.disabled=iso(first).slice(0,7)<=lower.slice(0,7);
      next.disabled=iso(first).slice(0,7)>=upper.slice(0,7);
      prev.setAttribute('aria-label','이전 달'); next.setAttribute('aria-label','다음 달');
      grid.replaceChildren();
      const occupied = first.getDay();
      for (let i=0; i<42; i++) {
        const cursor=shiftDay(first,i-occupied);
        if (cursor.getMonth()!==first.getMonth()) { grid.append(element('span')); continue; }
        const key=iso(cursor), b=button(String(cursor.getDate()), key, ()=>select(key));
        b.dataset.day=key; b.disabled=key<lower||key>upper;
        b.tabIndex=key===iso(current)?0:-1; b.setAttribute('aria-pressed',String(key===chosen));
        if (key===today) b.setAttribute('aria-current','date');
        grid.append(b);
      }
      updateTime();
      if (focus) grid.querySelector('button[tabindex="0"]')?.focus({preventScroll:true});
    }
    year.addEventListener('input',()=>{year.value=year.value.replace(/\D/g,'');renderJump();});
    year.addEventListener('keydown',e=>{
      if(e.key==='Enter'&&!e.isComposing){
        e.preventDefault();
        const month=current.getMonth()+1;
        if(monthAllowed(Number(year.value),month))jumpTo(Number(year.value),month);
        else monthButtons.find(b=>!b.disabled)?.focus();
      }
    });
    dialog.addEventListener('keydown', e=>{
      if (e.isComposing || e.keyCode===229) return;
      if (e.key==='Escape') { e.preventDefault(); e.stopPropagation(); if(jump.hidden) finish(); else toggleJump(); return; }
      if (!grid.contains(e.target)) return;
      const days={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-current.getDay(),End:6-current.getDay()};
      if (Object.hasOwn(days,e.key)) {
        e.preventDefault();
        const day=shiftDay(current,days[e.key]);
        current=asDate(day.getFullYear()>9999?upper:clamp(iso(day))); render(true);
      } else if (e.key==='PageUp'||e.key==='PageDown') {
        e.preventDefault(); moveMonth((e.key==='PageUp'?-1:1)*(e.shiftKey?12:1));
      }
    });
    dialog.addEventListener('close',cleanUp,{once:true});
    let frame=0;
    function place() {
      if (!field.isConnected || field.closest('[inert]') || !field.getClientRects().length) { finish(undefined,false); return; }
      const bounds=field.getBoundingClientRect();
      for (let ancestor=field.parentElement; ancestor && ancestor!==document.body; ancestor=ancestor.parentElement) {
        if (!/(auto|scroll|clip|hidden)/.test(getComputedStyle(ancestor).overflowY)) continue;
        const clip=ancestor.getBoundingClientRect();
        if (bounds.bottom<=clip.top || bounds.top>=clip.bottom) { finish(undefined,false); return; }
      }
      const viewport=window.visualViewport, margin=8, gap=6;
      const left=(viewport?.offsetLeft||0)+margin, top=(viewport?.offsetTop||0)+margin;
      const right=left+(viewport?.width||innerWidth)-margin*2, bottom=top+(viewport?.height||innerHeight)-margin*2;
      const width=Math.max(1,Math.min(318,right-left));
      dialog.style.width=width+'px';
      const edges=dialog.offsetHeight-dialog.clientHeight;
      const natural=dialog.scrollHeight+edges;
      const below=Math.max(0,bottom-bounds.bottom-gap), above=Math.max(0,bounds.top-top-gap);
      const side=below>=natural || below>=above ? 'down' : 'up';
      const height=Math.max(1,Math.min(natural,side==='up'?above:below));
      const y=side==='up'?bounds.top-gap-height:bounds.bottom+gap;
      dialog.style.maxHeight=height+'px';
      dialog.style.left=Math.max(left,Math.min(bounds.left,right-width))+'px';
      dialog.style.top=Math.max(top,Math.min(y,bottom-height))+'px';
      dialog.dataset.placement=side;
    }
    function update() { cancelAnimationFrame(frame); frame=requestAnimationFrame(place); }
    const observer=new ResizeObserver(update);
    const mutations=new MutationObserver(()=>{if(!field.isConnected || field.closest('[inert]'))finish(undefined,false);});
    document.body.append(dialog); render(false); dialog.show(); place();
    if (!dialog.open) return;
    grid.querySelector('button[tabindex="0"]')?.focus({preventScroll:true});
    observer.observe(field);
    mutations.observe(document.body,{childList:true,subtree:true});
    document.addEventListener('pointerdown',e=>{
      if(e.target!==field && !dialog.contains(e.target))finish(undefined,false);
    },{...lifetime,capture:true});
    document.addEventListener('focusin',e=>{
      if(e.target!==field && !dialog.contains(e.target))finish(undefined,false);
    },lifetime);
    document.addEventListener('scroll',e=>{if(!dialog.contains(e.target))update();},{...lifetime,capture:true});
    window.addEventListener('resize',update,lifetime);
    window.visualViewport?.addEventListener('resize',update,lifetime);
    window.visualViewport?.addEventListener('scroll',update,lifetime);
  }
  document.addEventListener('pointerdown',e=>{
    if(e.button===0 && e.target.matches?.(fieldSelector) && !e.target.readOnly) e.preventDefault();
  },true);
  document.addEventListener('click', e=>{
    if (e.target.matches?.(fieldSelector)) {e.preventDefault();open(e.target);}
  },true);
  document.addEventListener('keydown', e=>{
    if (!e.isComposing && e.keyCode!==229 && e.target.matches?.(fieldSelector) && (e.key===' '||e.key==='F4'||e.key==='Enter'||(e.altKey && e.key==='ArrowDown'))) {
      e.preventDefault();open(e.target);
    }
  });
}
