// 빙그레 출고박스 집계 — 원본 매크로(빙그레_출고박스_저온) 로직 재현
export const BOXES = [1, 2, 3, 4, 5, 6, 7].map(n => '아이스박스 ' + n + '호');
export const CHANNELS = [
  { key: 'direct', label: '직영몰 도착보장', title: '직영몰 스마트스토어 + 직영몰 스마트스토어(도착보장) + 배송사 도착보장 - 저온 · 아이스박스', sheet: '직영몰_도착보장_저온', test: o => o.chg === '직영몰(도착보장)' },
  { key: 'normal', label: '일반', title: '일반 - 저온 · 아이스박스', sheet: '일반_저온', test: o => o.chg === '일반' },
  { key: 'health', label: '건기식 도착보장', title: '건기식 스마트스토어(도착보장) - 저온 · 아이스박스', sheet: '건기식_도착보장', test: o => o.chg === '건기식(도착보장)' }
];
const str = v => (v == null ? '' : String(v)).trim();
const raw = v => (v == null ? '' : String(v));
const ns = s => str(s).replace(/\s+/g, '');
const fromSerial = s => new Date((s - 25569) * 86400000).toISOString().slice(0, 10);
// 등록일시 → 날짜 (00시 등록은 전날)
function dayOf(v) {
  let s, h;
  if (v instanceof Date) { s = Math.floor((v.getTime() - v.getTimezoneOffset() * 60000) / 86400000) + 25569; h = v.getHours(); }
  else if (typeof v === 'number' && isFinite(v)) { s = Math.floor(v); h = Math.floor((v - s) * 24 + 1e-7); }
  else {
    const t = str(v), m = t.match(/(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/);
    if (!m) return '';
    s = Math.round(Date.UTC(+m[1], m[2] - 1, +m[3]) / 86400000) + 25569;
    const tm = t.slice(m.index + m[0].length).match(/(\d{1,2}):(\d{2})/);
    h = tm ? +tm[1] : 0;
    if (tm && /오후|PM/i.test(t) && h < 12) h += 12;
    if (tm && /오전|AM/i.test(t) && h === 12) h = 0;
  }
  if (h === 0) s -= 1;
  return fromSerial(s);
}
// "아이스박스3호" "빙그레_3호" → "아이스박스 3호" "빙그레 3호"
function normBox(v) {
  const s = str(v); if (!s) return '';
  const t = s.replace(/[ _]/g, '');
  const fam = ['아이스박스', '종이박스', '빙그레'].find(f => t.startsWith(f));
  if (!fam) return s;
  let rest = t.slice(fam.length); if (rest.endsWith('호')) rest = rest.slice(0, -1);
  return /^\d+$/.test(rest) ? fam + ' ' + parseInt(rest, 10) + '호' : s;
}
const vol = v => { const p = raw(v).toUpperCase().split('X'); if (p.length !== 3) return 0; const n = p.map(x => x.trim()); return n.every(x => x !== '' && isFinite(+x)) ? n.reduce((a, x) => a * +x, 1) : 0; };
const zoneOf = (a, p) => /냉동|냉장/.test(a) ? '저온' : a.includes('상온') ? '상온' : /냉동|냉장/.test(p) ? '저온' : p.includes('상온') ? '상온' : '미분류';
const chGroup = (ch, arrive) => { const t = ch.replace(/ /g, ''); if (t.includes('도착보장') && t.includes('건기식')) return '건기식(도착보장)'; if (t.includes('직영몰스마트스토어') || arrive) return '직영몰(도착보장)'; return '일반'; };
// 가장 많이 나온 박스 (같으면 이름순)
const modeOf = arr => { const m = {}; arr.forEach(b => { m[b] = (m[b] || 0) + 1; }); let box = '', n = 0; for (const k in m) if (m[k] > n || (m[k] === n && k < box)) { box = k; n = m[k]; } return { box, n, of: arr.length }; };
const numOf = v => { const s = str(v).replace(/,/g, ''); return s && isFinite(+s) ? +s : 0; };
const K_NEIGHBOR = 7;

export function compute(rows, past = {}) {
  const REQ = ['등록일시', '상품명', '주문수량', '송장번호', '출고할당명', '판매 채널명', '스캔박스', '상품코드'];
  const OPT = ['박스별 수량', '출고박스 규격', '배송사 명'];
  const hi = Math.max(0, rows.slice(0, 10).findIndex(r => (r || []).some(c => ns(c) === '송장번호')));
  const head = (rows[hi] || []).map(ns), col = {};
  [...REQ, ...OPT].forEach(h => { const i = head.indexOf(ns(h)); if (i >= 0) col[h] = i; });
  const need = REQ.filter(h => !(h in col));
  if (need.length) throw new Error('[' + need.join('], [') + '] 열을 찾을 수 없습니다 · 원본 헤더가 그대로 있는지 확인하세요');
  const g = (r, h) => (h in col ? r[col[h]] : '');
  const qtyCol = '박스별 수량' in col ? '박스별 수량' : '주문수량';
  const map = new Map(), all = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!REQ.some(h => str(g(r, h)))) continue;
    const day = dayOf(g(r, '등록일시')), inv = str(g(r, '송장번호')), pname = raw(g(r, '상품명'));
    const allocRaw = raw(g(r, '출고할당명')), zone = zoneOf(allocRaw, pname), ch = str(g(r, '판매 채널명'));
    const qty = numOf(g(r, qtyCol)), key = day + '\x1e' + zone + '\x1e' + ch + '\x1e' + inv;
    let o = map.get(key);
    if (!o) { o = { inv, day, temp: zone, ch, nsku: 0, qty: 0, vol: 0, attach: false, arrive: false, scan: '', codes: [], labels: [], allocs: [] }; map.set(key, o); all.push(o); }
    if (pname.length) o.nsku++;
    o.qty += qty;
    if ('출고박스 규격' in col) o.vol += vol(g(r, '출고박스 규격')) * qty;
    if (zone === '상온' && pname.replace(/ /g, '').includes('박스출고')) o.attach = true;
    if ('배송사 명' in col && raw(g(r, '배송사 명')).includes('도착')) o.arrive = true;
    const sb = normBox(g(r, '스캔박스')); if (!o.scan && sb) o.scan = sb;
    o.codes.push(str(g(r, '상품코드')) + ':' + qty);
    const al = str(allocRaw); if (al && !o.allocs.includes(al)) o.allocs.push(al);
    o.labels.push(pname.trim() + ' x' + qty);
  }
  if (!all.length) throw new Error('송장 데이터가 없습니다');
  for (const o of all) {
    o.comp = o.temp + '\x1d' + o.codes.sort().join('|');
    o.combo = o.labels.sort().join(' / ');
    o.alloc = o.allocs.join(', ');
    o.chg = chGroup(o.ch, o.arrive);
    delete o.codes; delete o.labels; delete o.allocs;
  }
  const learn = all.filter(o => o.scan && !o.attach), byComp = new Map(), byDay = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  learn.forEach(o => { push(byComp, o.comp, o.scan); push(byDay, o.day + '\x1c' + o.comp, o.scan); });
  for (const o of all) {
    if (o.attach) { o.box = '송장부착'; o.how = '송장부착(박스출고 상품)'; o.src = 'attach'; continue; }
    if (o.scan) { o.box = o.scan; o.how = '스캔'; o.src = 'scan'; continue; }
    const sd = byDay.get(o.day + '\x1c' + o.comp);
    if (sd) { const t = modeOf(sd); o.box = t.box; o.how = '구성이력-같은 날 스캔 ' + t.of + '건 중 ' + t.n + '건'; o.src = 'hist'; continue; }
    const sc = byComp.get(o.comp);
    if (sc) { const t = modeOf(sc); o.box = t.box; o.how = '구성이력-다른 날 스캔 ' + t.of + '건 중 ' + t.n + '건'; o.src = 'hist'; continue; }
    const lv = Math.log(1 + o.vol);
    const near = learn.filter(t => t.temp === o.temp || o.temp === '미분류')
      .map((t, i) => ({ t, i, d: Math.abs(Math.log(1 + t.vol) - lv) }))
      .sort((a, b) => a.d - b.d || a.i - b.i).slice(0, K_NEIGHBOR);
    o.src = 'pred';
    if (!near.length) { o.box = '예측불가'; o.how = '예측불가(스캔 데이터 없음)'; continue; }
    const t = modeOf(near.map(x => x.t.scan)); o.box = t.box; o.how = '예측-비슷한 부피 ' + t.of + '건 중 ' + t.n + '건(참고용)';
  }
  for (const o of all) {
    const tag = o.box === '송장부착';
    o.boxN = tag ? 0 : o.inv.split(',').length;
    o.single = !tag && o.nsku === 1 && o.qty === 1 ? 1 : 0;
    o.same = !tag && o.nsku === 1 && o.qty !== 1 ? 1 : 0;
    o.mixed = !tag && o.nsku >= 2 ? 1 : 0;
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  all.sort((a, b) => (!a.day !== !b.day ? (a.day ? -1 : 1) : 0) || cmp(a.day, b.day) || cmp(a.temp, b.temp) || cmp(a.ch, b.ch) || cmp(a.inv, b.inv));
  return { invoices: all, rowCount: rows.length - hi - 1 };
}

// 스캔된 구성 → 박스 누적 (다음 달 판정에 사용)
export function mergeHistory(past, res) {
  const h = JSON.parse(JSON.stringify(past || {}));
  res.invoices.filter(o => o.src === 'scan').forEach(o => { const m = h[o.combo] || (h[o.combo] = {}); m[o.box] = (m[o.box] || 0) + 1; });
  return h;
}

export function stats(res) {
  const inv = res.invoices, c = k => inv.filter(o => o.src === k).length;
  return { total: inv.length, scan: c('scan'), hist: c('hist'), pred: c('pred') + c('none') };
}

export function channelTable(res, key) {
  const ch = CHANNELS.find(c => c.key === key) || CHANNELS[0];
  const days = [...new Set(res.invoices.map(o => o.day).filter(Boolean))].sort();
  const pick = res.invoices.filter(o => o.temp === '저온' && ch.test(o));
  const rows = days.map(d => {
    const list = pick.filter(o => o.day === d);
    const cells = BOXES.map(b => list.filter(o => o.box === b).length);
    cells.push(list.length - cells.reduce((s, n) => s + n, 0));
    cells.push(list.length);
    return { day: d, cells };
  });
  const tot = BOXES.map((_, i) => rows.reduce((s, r) => s + r.cells[i], 0));
  tot.push(rows.reduce((s, r) => s + r.cells[7], 0), rows.reduce((s, r) => s + r.cells[8], 0));
  return { ch, rows, tot };
}

export function comboTable(res) {
  const m = new Map();
  res.invoices.filter(o => o.temp === '저온' && o.box !== '송장부착').forEach(o => {
    if (!m.has(o.combo)) m.set(o.combo, BOXES.map(() => 0).concat([0, 0]));
    const a = m.get(o.combo), i = BOXES.indexOf(o.box);
    a[i >= 0 ? i : 7]++; a[8]++;
  });
  return [...m.entries()].map(([combo, cells]) => {
    let mi = 0; cells.slice(0, 8).forEach((n, i) => { if (n > cells[mi]) mi = i; });
    return { combo, cells, main: cells[8] ? (mi < 7 ? BOXES[mi] : '기타') : '' };
  }).sort((a, b) => b.cells[8] - a.cells[8] || (a.combo < b.combo ? -1 : a.combo > b.combo ? 1 : 0));
}

const FN = '맑은 고딕';
const solid = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = { style: 'thin', color: { auto: true } }, BD = { top: thin, left: thin, bottom: thin, right: thin };
const CEN = { horizontal: 'center', vertical: 'middle' }, VM = { vertical: 'middle' };
const NF0 = '#,##0;\\-#,##0;';
const serial = d => { const [y, m, dd] = d.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, dd) / 86400000) + 25569; };
const q = v => String(v).replace(/"/g, '""');
const put = (ws, r, c, v, st) => { const cell = ws.getCell(r, c); cell.value = v; if (st) Object.assign(cell, st); return cell; };
const ST = {
  hd: { font: { name: FN, size: 11, bold: true, color: { argb: 'FFFFFFFF' } }, fill: solid('FF305496'), alignment: VM },
  date: { font: { name: FN, size: 11 }, numFmt: 'yyyy\\-mm\\-dd', alignment: VM },
  txt: { font: { name: FN, size: 11 }, alignment: VM },
  tot: { font: { name: FN, size: 11, bold: true }, alignment: VM },
  title: { font: { name: FN, size: 11, bold: true }, alignment: CEN },
  bh: { font: { name: FN, size: 10, bold: true }, fill: solid('FFF2F2F2'), border: BD, alignment: CEN },
  bday: { font: { name: FN, size: 10 }, numFmt: 'm"월" dd"일"', border: BD, alignment: CEN },
  bnum: { font: { name: FN, size: 10 }, numFmt: NF0, border: BD, alignment: CEN },
  btl: { font: { name: FN, size: 10, bold: true }, fill: solid('FFD9E1F2'), border: BD, alignment: CEN },
  btn: { font: { name: FN, size: 10, bold: true }, fill: solid('FFD9E1F2'), numFmt: NF0, border: BD, alignment: CEN },
  ch: { font: { name: FN, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }, fill: solid('FF305496'), alignment: CEN },
  ca: { font: { name: FN, size: 10 }, alignment: VM },
  cn: { font: { name: FN, size: 10 }, numFmt: NF0, alignment: CEN },
  ck: { font: { name: FN, size: 10 }, alignment: CEN }
};
const YEL = solid('FFFFF2CC'), GRN = solid('FFE2EFDA');

function monthDays(res) {
  const d = res.invoices.map(o => o.day).filter(Boolean).sort();
  if (!d.length) return [];
  const [y0, m0] = d[0].split('-').map(Number), [y1, m1] = d[d.length - 1].split('-').map(Number);
  const a = Date.UTC(y0, m0 - 1, 1), b = Date.UTC(y1, m1, 0), out = [];
  for (let t = a; t <= b; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export function addSheets(wb, res) {
  const inv = res.invoices;
  const L = inv.length + 1, rg = c => '통합!$' + c + '$2:$' + c + '$' + L;
  // 통합
  const ws = wb.addWorksheet('통합', { views: [{ state: 'frozen', ySplit: 1 }], properties: { tabColor: { argb: 'FF4BACC6' } } });
  ['등록일시', '온도구분', '판매채널명', '송장번호', '상품명 개수', '수량 합계', '박스', '박스판정', '박스수', '동종합포', '이종합포', '송장부착', '채널구분', '구성(상품명 x수량)', '출고할당명', '단포'].forEach((h, j) => put(ws, 1, j + 1, h, ST.hd));
  inv.forEach((o, k) => {
    const r = k + 2, tag = o.box === '송장부착', fill = o.src === 'hist' || o.src === 'pred' ? YEL : o.src === 'attach' ? GRN : null;
    const vals = [o.day ? serial(o.day) : '', o.temp, o.ch, o.inv, o.nsku, o.qty, o.box, o.how,
      { formula: 'IF($G' + r + '="송장부착",0,LEN($D' + r + ')-LEN(SUBSTITUTE($D' + r + ',",",""))+1)', result: o.boxN },
      { formula: 'IF($G' + r + '="송장부착",0,IF(AND($E' + r + '=1,$F' + r + '<>1),1,0))', result: o.same },
      { formula: 'IF($G' + r + '="송장부착",0,IF($E' + r + '>=2,1,0))', result: o.mixed },
      { formula: 'IF($G' + r + '="송장부착",1,0)', result: tag ? 1 : 0 },
      o.chg, o.combo, o.alloc,
      { formula: 'IF($G' + r + '="송장부착",0,IF(AND($E' + r + '=1,$F' + r + '=1),1,0))', result: o.single }];
    vals.forEach((v, j) => { const c = put(ws, r, j + 1, v, j === 0 ? ST.date : ST.txt); if (fill) c.fill = fill; if (j === 3 || j >= 13 && j <= 14) c.quotePrefix = true; });
  });
  const T = L + 1, sum = (c, k) => ({ formula: 'SUM(' + c + '$2:' + c + L + ')', result: inv.reduce((s, o) => s + k(o), 0) });
  for (let j = 1; j <= 16; j++) put(ws, T, j, null, ST.tot);
  ws.getCell(T, 1).value = '총합계';
  ws.getCell(T, 5).value = sum('E', o => o.nsku); ws.getCell(T, 6).value = sum('F', o => o.qty);
  ws.getCell(T, 9).value = sum('I', o => o.boxN); ws.getCell(T, 10).value = sum('J', o => o.same);
  ws.getCell(T, 11).value = sum('K', o => o.mixed); ws.getCell(T, 12).value = sum('L', o => (o.box === '송장부착' ? 1 : 0));
  ws.getCell(T, 16).value = sum('P', o => o.single);
  ws.autoFilter = 'A1:P' + L;
  [11.25, 11.25, 29.625, 16.125, 13.875, 11.875, 14.875, 32.625, 9.375, 11.25, 11.25, 11.25, 16.5, 70.625, 30.625, 7.5].forEach((w, j) => { ws.getColumn(j + 1).width = w; });
  // 채널별 시트
  const days = monthDays(res), HB = ['날짜', ...BOXES.map(b => b.replace(' ', '')), '기타', '합계'];
  const block = (s, top, title, crit, test) => {
    for (let j = 1; j <= 10; j++) put(s, top, j, j === 1 ? title : null, ST.title);
    s.mergeCells(top, 1, top, 10);
    HB.forEach((h, j) => put(s, top + 1, j + 1, h, ST.bh));
    const pick = inv.filter(o => o.temp === '저온' && test(o)), first = top + 2;
    days.forEach((d, k) => {
      const r = first + k, list = pick.filter(o => o.day === d), base = 'COUNTIFS(' + rg('A') + ',$A' + r + ',' + crit + ',' + rg('B') + ',"저온"';
      put(s, r, 1, serial(d), ST.bday);
      let acc = 0;
      BOXES.forEach((b, j) => { const n = list.filter(o => o.box === b).length; acc += n; put(s, r, j + 2, { formula: base + ',' + rg('G') + ',"' + b + '")', result: n }, ST.bnum); });
      put(s, r, 9, { formula: base + ')-SUM($B' + r + ':H' + r + ')', result: list.length - acc }, ST.bnum);
      put(s, r, 10, { formula: 'SUM($B' + r + ':I' + r + ')', result: list.length }, ST.bnum);
    });
    const tr = first + days.length, lastD = tr - 1;
    put(s, tr, 1, '합계', ST.btl);
    for (let j = 2; j <= 10; j++) {
      const col = String.fromCharCode(64 + j);
      let v = 0; for (let r = first; r <= lastD; r++) v += Number(s.getCell(r, j).value.result) || 0;
      put(s, tr, j, { formula: 'SUM(' + col + '$' + first + ':' + col + lastD + ')', result: v }, ST.btn);
    }
    return tr;
  };
  const sheetOf = (name, frozen) => { const s = wb.addWorksheet(name, frozen ? { views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }] } : {}); for (let j = 1; j <= 10; j++) s.getColumn(j).width = 11.625; return s; };
  const crit = (c, v) => rg(c) + ',"' + q(v) + '"';
  block(sheetOf('직영몰_도착보장_저온', true), 1, '직영몰 스마트스토어 + 직영몰 스마트스토어(도착보장) + 배송사 도착보장 - 저온 · 아이스박스', crit('M', '직영몰(도착보장)'), o => o.chg === '직영몰(도착보장)');
  block(sheetOf('일반_저온', true), 1, '일반 - 저온 · 아이스박스', crit('M', '일반'), o => o.chg === '일반');
  block(sheetOf('건기식_도착보장', true), 1, '건기식 스마트스토어(도착보장) - 저온 · 아이스박스', crit('M', '건기식(도착보장)'), o => o.chg === '건기식(도착보장)');
  // 구성별_박스
  const cs = wb.addWorksheet('구성별_박스', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  ['구성(상품명 x수량)', ...BOXES.map(b => b.replace(' ', '')), '기타', '합계', '주로 쓴 박스'].forEach((h, j) => put(cs, 1, j + 1, h, ST.ch));
  const combos = comboTable(res);
  combos.forEach((row, k) => {
    const r = k + 2, key = 'COUNTIFS(' + rg('N') + ',"="&SUBSTITUTE(SUBSTITUTE(SUBSTITUTE($A' + r + ',"~","~~"),"*","~*"),"?","~?"),' + rg('B') + ',"저온"';
    const a = put(cs, r, 1, row.combo, ST.ca); a.quotePrefix = true;
    BOXES.forEach((b, j) => put(cs, r, j + 2, { formula: key + ',' + rg('G') + ',"' + b + '")', result: row.cells[j] }, ST.cn));
    put(cs, r, 9, { formula: key + ')-SUM($B' + r + ':H' + r + ')', result: row.cells[7] }, ST.cn);
    put(cs, r, 10, { formula: 'SUM($B' + r + ':I' + r + ')', result: row.cells[8] }, ST.cn);
    put(cs, r, 11, { formula: 'IF(J' + r + '=0,"",INDEX($B$1:$I$1,MATCH(MAX($B' + r + ':$I' + r + '),$B' + r + ':$I' + r + ',0)))', result: row.main.replace(' ', '') }, ST.ck);
  });
  cs.autoFilter = 'A1:K' + (combos.length + 1);
  cs.getColumn(1).width = 70.625; for (let j = 2; j <= 11; j++) cs.getColumn(j).width = 10.625;
  wb.calcProperties = Object.assign(wb.calcProperties || {}, { fullCalcOnLoad: true });
  return wb;
}

export async function buildExcel(res) {
  const wb = new ExcelJS.Workbook();
  addSheets(wb, res);
  return wb.xlsx.writeBuffer();
}

// 저장·공유용 압축 (문자열 표 + 탭 구분 줄)
const PF = ['inv', 'day', 'temp', 'ch', 'chg', 'box', 'how', 'nsku', 'qty', 'combo', 'alloc', 'boxN', 'same', 'mixed', 'single', 'add', 'src'];
const TBL = { ch: 1, chg: 1, box: 1, how: 1, combo: 1, alloc: 1, temp: 1, src: 1 };
export function pack(res) {
  const tab = [], idx = new Map(), id = v => { v = v == null ? '' : String(v); let i = idx.get(v); if (i == null) { i = tab.length; tab.push(v); idx.set(v, i); } return i; };
  const lines = res.invoices.map(o => PF.map(f => (TBL[f] ? id(o[f]) : f === 'add' ? (o.add ? 1 : 0) : o[f] == null ? '' : o[f])).join('\t'));
  return { v: 1, strs: tab, rows: lines.join('\n') };
}
export function unpack(p) {
  if (!p || !p.rows) return null;
  const T = p.strs || [];
  const invoices = p.rows.split('\n').map(l => {
    const a = l.split('\t'), o = {};
    PF.forEach((f, i) => { const v = a[i]; o[f] = TBL[f] ? T[+v] : f === 'inv' || f === 'day' ? v : f === 'add' ? v === '1' : +v || 0; });
    return o;
  });
  return { invoices };
}
