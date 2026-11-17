export const largeDraftThreshold = 256_000;
export const draftWindowSize = 12_000;

export function draftWindow(text, page) {
  if (text.length <= largeDraftThreshold) return {start:0,end:text.length,page:0,count:1};
  const count = Math.ceil(text.length / draftWindowSize);
  page = Number.isFinite(page) ? Math.min(count - 1, Math.max(0, Math.floor(page))) : 0;
  function boundary(position) {
    const unit = text.charCodeAt(position);
    return unit >= 0xdc00 && unit <= 0xdfff && position > 0 &&
      text.charCodeAt(position - 1) >= 0xd800 && text.charCodeAt(position - 1) <= 0xdbff
      ? position - 1 : position;
  }
  return {start:boundary(page * draftWindowSize),end:boundary(Math.min(text.length,(page + 1) * draftWindowSize)),page,count};
}
