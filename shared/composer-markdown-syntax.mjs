// Preserve source offsets so native input, selection and submitted Markdown use the same text.
import { parse, postprocess, preprocess } from 'micromark';
import { gfm } from 'micromark-extension-gfm';

const syntax = gfm();
const styles = {
  atxHeadingText:'heading', setextHeadingText:'heading',
  strongText:'strong', emphasisText:'em',
  blockQuote:'quote', codeTextData:'code', codeFlowValue:'code',
  labelText:'link', literalAutolink:'link', autolinkProtocol:'link', autolinkEmail:'link',
  resourceDestination:'destination', taskListCheck:'task',
  listItemPrefix:'bullet', blockQuoteMarker:'marker', thematicBreak:'marker',
  tableDelimiterMarker:'marker', tableDelimiterFiller:'marker', tableDelimiter:'marker',
  codeFencedFence:'marker', atxHeadingSequence:'marker', setextHeadingLine:'marker',
  strongSequence:'marker', emphasisSequence:'marker',
  codeTextSequence:'marker', labelMarker:'marker', resourceMarker:'marker',
};
export function markdownRanges(source) {
  if (!/[#>*_~\x60\[\]|\\-]|^\s*(?:\d+[.)]|\+)\s/m.test(source)) return [];
  const events = postprocess(parse({extensions:[syntax, {disable:{null:['strikethrough']}}]}).document().write(preprocess()(source, undefined, true)));
  const ranges = [];
  for (const [phase, token] of events) {
    const style = styles[token.type];
    if (!style) continue;
    const start = token.start.offset;
    // A bare '*' is still being typed. Give a list a visual marker once the
    // separator is present, and include the number in an ordered marker.
    const prefix = style === 'bullet' && /^(?:\d{1,9}[.)]|[-+*])(?=[ \t])/.exec(source.slice(start,start+12));
    if (style === 'bullet' && !prefix) continue;
    ranges.push([phase === 'enter' ? start : prefix ? start + prefix[0].length : token.end.offset, phase === 'enter' ? style : null]);
  }
  return ranges;
}
