// Shared by the desktop bundle and the mobile browser. Runtime IDs stay intact.
const effortNames = Object.freeze({
  none: '추론 사용 안 함 (None)',
  minimal: '최소한으로 (Minimal)',
  low: '가볍게 / 빠른 탐색 (Low)',
  medium: '균형 있게 / 일반 작업 (Medium)',
  high: '깊이 있게 / 복잡한 문제 (High)',
  xhigh: '매우 깊이 있게 (XHigh)',
  max: '최대 깊이 (Max)',
  ultra: '가장 깊이 있게 (Ultra)',
});

function suffixName(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const snapshot = value.match(/-(\d{4}-\d{2}-\d{2})$/);
  const words = snapshot ? value.slice(0, -snapshot[0].length) : value;
  const title = words.split('-').map(word => word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : '').join(' ');
  return snapshot ? `${title} ${snapshot[1]}` : title;
}

export function modelDisplayName(model) {
  const id = typeof model === 'string' ? model : model?.id;
  const name = typeof model === 'object' && model ? model.displayName : undefined;
  const value = typeof id === 'string' ? id.trim() : '';
  const gpt = value.match(/^gpt-(\d+(?:\.\d+)*)(?:-(.+))?$/i);
  // The catalog ID is authoritative for the model version, even with a stale label.
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${suffixName(gpt[2])}` : ''}`;
  return typeof name === 'string' && name.trim() ? name.trim() : value;
}

export function effortDisplayName(effort) {
  if (!effort) return '';
  return Object.hasOwn(effortNames, effort) ? effortNames[effort] : `서버 제공 값 (${effort})`;
}

export const effortLabels = effortNames;

export function reasoningEffortOptions(model) {
  // Missing capability metadata must not invent options for a model.
  return Array.isArray(model?.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts.filter(row => typeof row?.reasoningEffort === 'string' && row.reasoningEffort).map(row => ({...row}))
    : [];
}
