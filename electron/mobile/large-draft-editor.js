export const largeDraftThreshold = 256_000;
export const draftWindowSize = 12_000;
const longLineProbe=32_000;

export function shouldWindowDraft(text) {
  if(text.length>largeDraftThreshold)return true;
  if(text.length<=longLineProbe)return false;
  // At most eight blocks; a line longer than a block must cross a boundary.
  let trailing=0;
  for(let start=0;start<text.length;start+=longLineProbe) {
    const block=text.slice(start,start+longLineProbe), first=block.indexOf('\n');
    if(trailing+(first<0?block.length:first)>longLineProbe)return true;
    trailing=first<0?trailing+block.length:block.length-block.lastIndexOf('\n')-1;
  }
  return false;
}

export function draftWindow(text, page) {
  if (!shouldWindowDraft(text)) return {start:0,end:text.length,page:0,count:1};
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
