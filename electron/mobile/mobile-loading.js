const make = (tag, className, text) => {
  const element = document.createElement(tag);
  element.className = className;
  if (text) element.textContent = text;
  return element;
};

function lines(count = 2) {
  return Array.from({length:count},() => make('span','mobile-loading-line'));
}

function listCard(count, style = '') {
  const card = make('div','mobile-loading-card' + (style ? ' ' + style : ''));
  card.append(make('span','mobile-loading-line mobile-loading-card-title'));
  for (let index = 0; index < count; index++) {
    const row = make('div','mobile-loading-row');
    row.append(make('span','mobile-loading-tile'));
    const text = make('div','mobile-loading-lines');
    text.append(...lines());
    row.append(text);
    card.append(row);
  }
  return card;
}

function dashboardArt(art) {
  const overview = make('div','mobile-loading-card mobile-loading-overview');
  overview.append(...lines(2));
  const metrics = make('div','mobile-loading-metrics');
  for (let index = 0; index < 3; index++) metrics.append(make('span','mobile-loading-tile'));
  overview.append(metrics);
  const panels = make('div','mobile-loading-columns');
  panels.append(listCard(2),listCard(2));
  art.append(overview,panels);
}

function chatArt(art) {
  const question = make('div','mobile-loading-bubble mobile-loading-bubble-user');
  question.append(...lines(1));
  const answer = make('div','mobile-loading-answer');
  const author = make('div','mobile-loading-author');
  author.append(make('span','mobile-loading-tile'),...lines(1));
  const bubble = make('div','mobile-loading-bubble');
  bubble.append(...lines(3));
  answer.append(author,bubble);
  art.append(question,answer);
}

const illustrations = {
  dashboard: dashboardArt,
  chat: chatArt,
  project(art) { art.append(listCard(3)); },
  assistant(art) { art.append(listCard(2)); },
  settings(art) { art.append(listCard(3,'mobile-loading-controls')); },
  document(art) {
    const page = make('div','mobile-loading-card mobile-loading-document');
    page.append(...lines(6));
    art.append(page);
  },
  rows(art) { art.append(listCard(2)); },
};

export function createMobileLoading(name, layout, progress) {
  const region = make('section','mobile-skeleton mobile-loading');
  region.dataset.layout = layout;
  region.dataset.loadingName = name;
  region.setAttribute('role','status');
  region.setAttribute('aria-label',name + ' 불러오는 중');
  const header = make('div','mobile-loading-header');
  const heading = make('div','mobile-loading-heading');
  const spinner = make('span','mobile-loading-spinner');
  spinner.setAttribute('aria-hidden','true');
  heading.append(spinner,make('strong','mobile-loading-title',name + ' 불러오는 중'));
  const detail = make('span','mobile-loading-detail');
  const count = make('span','mobile-loading-count');
  count.setAttribute('aria-hidden','true');
  const meter = make('div','mobile-loading-progress');
  meter.setAttribute('role','progressbar');
  meter.setAttribute('aria-label',name + ' 불러오기 진행 단계');
  const fill = make('span','mobile-loading-fill');
  fill.setAttribute('aria-hidden','true');
  meter.append(fill);
  header.append(heading,count,detail,meter);
  const art = make('div','mobile-loading-art');
  art.setAttribute('aria-hidden','true');
  (illustrations[layout] ?? illustrations.rows)(art);
  region.append(header,art);
  updateMobileLoading(region,progress);
  return region;
}

export function updateMobileLoading(region, progress) {
  const { value = 0, total = 2, detail = '데스크톱에 자료를 요청하는 중' } = progress ?? {};
  const meter = region.querySelector('.mobile-loading-progress');
  meter.setAttribute('aria-valuemin','0');
  meter.setAttribute('aria-valuemax',String(total));
  meter.setAttribute('aria-valuenow',String(value));
  meter.setAttribute('aria-valuetext',`${total}단계 중 ${value}단계 완료 / ${detail}`);
  meter.style.setProperty('--mobile-loading-ratio',String(value / total));
  region.querySelector('.mobile-loading-count').textContent = `${value} / ${total}단계`;
  region.querySelector('.mobile-loading-detail').textContent = detail;
  region.toggleAttribute('data-loading-complete',value === total);
}
