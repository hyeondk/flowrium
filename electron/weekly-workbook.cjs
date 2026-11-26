const { createRequire } = require('node:module');
const MarkdownIt = require('markdown-it');

const markdown = new MarkdownIt({ html: false });
const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const escapeXML = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xml = body => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + body;
const sheetName = '주간업무보고서';
const currentHeading = '금주 업무내용';
const nextHeading = '차주 업무계획';
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const short = (value, limit) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
const task = value => short(value, 1800).replace(/[.!]$/, '')
  .replace(/(?:할 예정입니다|할 계획입니다)$/, ' 예정').replace(/(?:하였습니다|했습니다|하였다|했다|합니다)$/, '');

function inlineText(token) {
  return token?.children?.map(item => {
    if (item.type === 'softbreak' || item.type === 'hardbreak') return ' ';
    return ['text', 'code_inline', 'image'].includes(item.type) ? item.content : '';
  }).join('') || token?.content || '';
}

function weeklyRows(answer, defaultGroup) {
  const tokens = markdown.parse(String(answer).slice(0, 100000), {});
  const current = [], next = [], fallback = [];
  let section = current, row, table = false, readingRow = false;
  for (const [index, token] of tokens.entries()) {
    if (token.type === 'heading_open') {
      const heading = inlineText(tokens[index + 1]);
      section = /차주|다음\s*(?:주|주간)|업무\s*계획/.test(heading) ? next :
        /금주|이번\s*주|실적|진행\s*업무/.test(heading) ? current :
          /근거|참고|출처/.test(heading) ? null : section;
    }
    if (token.type === 'table_open') table = true;
    if (token.type === 'table_close') table = false;
    if (token.type === 'tr_open') row = [];
    if (token.type === 'td_open') readingRow = true;
    if (token.type === 'td_close') readingRow = false;
    if (token.type === 'inline' && readingRow) row.push(inlineText(token));
    if (token.type === 'tr_close' && section && row.length >= 2 && row[1].trim() && section.length < 150) {
      const [group, work, day, note] = row;
      section.push({ group: short(group, 100) || defaultGroup, work: task(work), date: short(day, 30), note: short(note, 500) });
    }
    if (token.type === 'inline' && !table && section && tokens[index - 1]?.type === 'paragraph_open' && fallback.length < 20) {
      const work = task(inlineText(token));
      if (work) fallback.push({ section, work });
    }
  }
  if (!current.length && !next.length)
    for (const { section: target, work } of fallback) target.push({ group: defaultGroup, work });
  return { current, next };
}

function grouped(rows) {
  const groups = new Map();
  for (const row of rows) {
    const group = short(row.group, 100);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row);
  }
  return [...groups];
}

function wrappedParts(value, limit) {
  const parts = [];
  let line = '';
  for (const word of short(value, 1800).split(' ')) {
    if (line && line.length + word.length + 1 > limit) {
      parts.push(line);
      line = '';
    }
    line += (line ? ' ' : '') + word;
  }
  parts.push(line);
  return parts;
}

function worksheet({ title, affiliation, from, to, createdAt, current, next }) {
  const dateText = value => validDate(value) ? value.replace(/-/g, '.') + '.' : '';
  const cell = (col, row, value, style) => {
    const reference = col + row;
    if (style === 10 && validDate(value)) return '<c r="' + reference + '" s="10"><v>' + (Date.parse(value) / 86400000 + 25569) + '</v></c>';
    return '<c r="' + reference + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' + escapeXML(value) + '</t></is></c>';
  };
  const rows = [], merges = [];
  const columns = [...'BCDEFGH'];
  function append(height, values, styles, ranges = []) {
    const index = rows.length + 1;
    rows.push('<row r="' + index + '" ht="' + height + '" customHeight="1">' +
      columns.map((col, offset) => cell(col, index, values[offset], styles[offset] || 0)).join('') + '</row>');
    for (const [first, last] of ranges) merges.push(first + index + ':' + last + index);
    return index;
  }
  append(6, [], []);
  append(34, [title || sheetName], [1,1,1,1,1,1,1], [['B','H']]);
  append(23, ['소속 / 이름', affiliation, '', '', '', '작성일', dateText(createdAt)], [2,3,3,3,3,2,3], [['C','F']]);
  const period = [dateText(from), dateText(to)].filter(Boolean).join(' ~ ');
  append(23, ['금주 날짜', period, '', '', '', '', ''], [2,3,3,3,3,3,3], [['C','H']]);
  function table(heading, source, emptyText) {
    append(30, ['구분', heading, '', '', '', '완료일\n(예정일)', '비고'], [4,4,4,4,4,4,4], [['C','F']]);
    const groups = grouped(source.length ? source : [{ group:'', work:emptyText }]);
    for (const [group, entries] of groups) {
      const first = rows.length + 1;
      for (const entry of entries) {
        const workParts = wrappedParts(entry.work, 700), noteParts = wrappedParts(entry.note, 270);
        for (let index = 0; index < Math.max(workParts.length, noteParts.length); index++) {
          const work = workParts[index] || '', note = noteParts[index] || '', date = index === 0 ? entry.date || '' : '';
          const firstEntry = rows.length + 1 === first;
          const workLines = Math.ceil(Array.from(work).length / 35);
          const noteLines = Math.ceil(Array.from(note).length / 13);
          const groupLines = firstEntry ? Math.ceil(Array.from(group).length / 7) : 0;
          const height = Math.min(390, Math.max(25, Math.max(workLines, noteLines, groupLines) * 16 + 10));
          append(height, [firstEntry ? group : '', work, '', '', '', date, note],
            [5,6,6,6,6,validDate(date) ? 10 : 7,8], [['C','F']]);
        }
      }
      if (rows.length > first) merges.push('B' + first + ':B' + rows.length);
    }
  }
  table(currentHeading, current, '해당 기간에 확인된 업무 없음');
  append(13, [], []);
  table(nextHeading, next, '확인된 차주 계획 없음');
  return {
    lastRow: rows.length,
    content: xml('<worksheet xmlns="' + spreadsheet + '"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="B1:H' + rows.length + '"/>' +
      '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="16.5"/>' +
      '<cols>' + [1.66, 11.66, 3.16, 22.5, 2.66, 29, 12.33, 23.83].map((width, index) => '<col min="' + (index + 1) +
      '" max="' + (index + 1) + '" width="' + width + '" customWidth="1"/>').join('') + '</cols><sheetData>' + rows.join('') + '</sheetData>' +
      '<mergeCells count="' + merges.length + '">' + merges.map(ref => '<mergeCell ref="' + ref + '"/>').join('') + '</mergeCells>' +
      '<printOptions horizontalCentered="1"/><pageMargins left="0.24" right="0.24" top="0.35" bottom="0.35" header="0.31" footer="0.31"/>' +
      '<pageSetup paperSize="9" fitToWidth="1" fitToHeight="0" orientation="portrait"/></worksheet>'),
  };
}

function styles() {
  const font = (size, bold = false) => '<font>' + (bold ? '<b/>' : '') + '<sz val="' + size +
    '"/><color rgb="FF202A36"/><name val="맑은 고딕"/><family val="2"/><charset val="129"/></font>';
  const fill = color => '<fill><patternFill patternType="solid"><fgColor rgb="' + color + '"/><bgColor indexed="64"/></patternFill></fill>';
  const plainBorder = '<border><left/><right/><top/><bottom/><diagonal/></border>';
  const thinBorder = '<border>' + ['left','right','top','bottom'].map(side => '<' + side + ' style="thin"><color rgb="FF4F5B67"/></' + side + '>').join('') + '<diagonal/></border>';
  const normal = '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"';
  const alignment = (fontId, fillId, borderId, horizontal, number = 0) =>
    '<xf xfId="0" numFmtId="' + number + '" fontId="' + fontId + '" fillId="' + fillId + '" borderId="' + borderId +
    '" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"' + (number ? ' applyNumberFormat="1"' : '') +
    '><alignment horizontal="' + horizontal + '" vertical="center" wrapText="1"/></xf>';
  return xml('<styleSheet xmlns="' + spreadsheet + '"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>' +
    '<fonts count="3">' + [font(10), font(22, true), font(10, true)].join('') + '</fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    fill('FFF1F2F4') + fill('FFE3EAF3') + '</fills><borders count="2">' + plainBorder + thinBorder + '</borders>' +
    '<cellStyleXfs count="1">' + normal + '/></cellStyleXfs><cellXfs count="11">' + normal + ' xfId="0"/>' +
    alignment(1,0,0,'center') + alignment(2,2,1,'center') + alignment(0,0,1,'center') + alignment(2,3,1,'center') +
    alignment(2,2,1,'center') + alignment(0,0,1,'left') + alignment(0,0,1,'center') + alignment(0,0,1,'left') +
    alignment(0,0,0,'left') + alignment(0,0,1,'center',164) + '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
}

async function writeWeeklyWorkbook(report) {
  const Zip = createRequire(require.resolve('pptxgenjs'))('jszip');
  const zip = new Zip();
  const sheet = worksheet(report);
  const packageRels = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
  zip.file('[Content_Types].xml', xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="' + type + 'sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="' +
    type + 'worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="' + type + 'styles+xml"/></Types>'));
  zip.file('_rels/.rels', xml('<Relationships xmlns="' + packageRels + '"><Relationship Id="rId1" Type="' + relationship +
    '/officeDocument" Target="xl/workbook.xml"/></Relationships>'));
  zip.file('xl/_rels/workbook.xml.rels', xml('<Relationships xmlns="' + packageRels + '"><Relationship Id="rId1" Type="' + relationship +
    '/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="' + relationship + '/styles" Target="styles.xml"/></Relationships>'));
  zip.file('xl/workbook.xml', xml('<workbook xmlns="' + spreadsheet + '" xmlns:r="' + relationship +
    '"><bookViews><workbookView/></bookViews><sheets><sheet name="' + sheetName + '" sheetId="1" r:id="rId1"/></sheets>' +
    '<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">\'' + sheetName + '\'!$B$2:$H$' + sheet.lastRow + '</definedName></definedNames></workbook>'));
  zip.file('xl/styles.xml', styles());
  zip.file('xl/worksheets/sheet1.xml', sheet.content);
  return zip.generateAsync({ type:'nodebuffer', compression:'DEFLATE' });
}

module.exports = { weeklyRows, writeWeeklyWorkbook };
