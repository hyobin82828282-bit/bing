// 빙그레 출고박스 집계 — 원본 매크로(빙그레_출고박스_저온) 로직 재현
export const BOXES = [1, 2, 3, 4, 5, 6, 7].map(n => '아이스박스 ' + n + '호');
export const CHANNELS = [
  { key: 'direct', label: '직영몰 도착보장', title: '직영몰 스마트스토어 + 직영몰 스마트스토어(도착보장) - 저온 · 아이스박스', sheet: '직영몰_도착보장_저온', test: o => o.chg === '직영몰(도착보장)' },
  { key: 'normal', label: '일반', title: '일반 - 저온 · 아이스박스', sheet: '일반_저온', test: o => o.chg === '일반' },
  { key: 'health', label: '건기식 도착보장', title: '건기식 스마트스토어(도착보장) - 저온 · 아이스박스', sheet: '건기식_도착보장', test: o => o.chg === '건기식(도착보장)' }
];
const str = v => (v == null ? '' : String(v)).trim();
const ns = s => str(s).replace(/\s+/g, '');
function toDay(v) {
  if (typeof v === 'number' && isFinite(v)) { const d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
  const m = str(v).match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  return m ? m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') : '';
}
const normBox = v => { const m = ns(v).match(/아이스박스(\d+)호/); return m ? '아이스박스 ' + m[1] + '호' : (ns(v).includes('송장부착') ? '송장부착' : str(v)); };
const vol = v => { const p = str(v).split(/\s*[xX×*]\s*/).map(Number); return p.length === 3 && p.every(isFinite) ? p[0] * p[1] * p[2] : 0; };
const chGroup = (ch, carrier = '') => { const c = ns(ch); if (c === '직영몰스마트스토어' || c === '직영몰스마트스토어(도착보장)') return '직영몰(도착보장)'; if (c.startsWith('건기식') && c.includes('도착보장')) return '건기식(도착보장)'; return str(carrier).includes('도착') ? '직영몰(도착보장)' : '일반'; };
const top = arr => { const m = {}; arr.forEach(b => { m[b] = (m[b] || 0) + 1; }); let best = '', n = 0; for (const k in m) if (m[k] > n) { best = k; n = m[k]; } return { box: best, n, of: arr.length }; };

export function compute(rows, past = {}) {
  const hi = Math.max(0, rows.slice(0, 10).findIndex(r => (r || []).some(c => str(c) === '송장번호')));
  const head = (rows[hi] || []).map(str), col = {};
  head.forEach((h, i) => { if (!(h in col)) col[h] = i; });
  const need = ['송장번호', '상품명', '주문수량', '등록일시'].filter(h => !(h in col));
  if (need.length) throw new Error('필요한 열이 없습니다: ' + need.join(', ') + ' · 출고 완료 상세 현황 파일인지 확인하세요');
  const g = (r, h) => (h in col ? r[col[h]] : '');
  const map = new Map();
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] || [], inv = str(g(r, '송장번호'));
    if (!inv) continue;
    let o = map.get(inv);
    if (!o) {
      const ch = str(g(r, '판매 채널명'));
      o = { inv, day: toDay(g(r, '등록일시')), ch, chg: chGroup(ch, g(r, '배송사 명')), alloc: str(g(r, '출고할당명')), pack: str(g(r, '합포장 번호')), order: str(g(r, '쇼핑몰 주문번호')), items: new Map(), qty: 0, vol: 0, scan: '', temp: '상온' };
      map.set(inv, o);
    }
    const name = str(g(r, '상품명')), q = parseFloat(String(g(r, '주문수량')).replace(/,/g, '')) || 0;
    o.items.set(name, (o.items.get(name) || 0) + q);
    o.qty += q; o.vol += vol(g(r, '출고박스 규격')) * q;
    if (/^\((냉동|냉장)\)/.test(name)) o.temp = '저온';
    const sb = str(g(r, '스캔박스'));
    if (sb && !o.scan) o.scan = normBox(sb);
  }
  const all = [...map.values()];
  if (!all.length) throw new Error('송장 데이터가 없습니다');
  for (const o of all) {
    o.nsku = o.items.size;
    o.combo = [...o.items.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([n, q]) => n + ' x' + q).join(' / ');
  }
  const scanned = all.filter(o => o.scan);
  const byCombo = new Map();
  scanned.forEach(o => { if (!byCombo.has(o.combo)) byCombo.set(o.combo, []); byCombo.get(o.combo).push(o); });
  const byVol = scanned.filter(o => o.vol > 0).sort((a, b) => a.vol - b.vol);
  for (const o of all) {
    if (o.scan) { o.box = o.scan; o.how = '스캔'; o.src = 'scan'; continue; }
    const hist = byCombo.get(o.combo) || [];
    const same = hist.filter(h => h.day === o.day);
    if (same.length) { const t = top(same.map(h => h.box || h.scan)); o.box = t.box; o.how = '구성이력-같은 날 스캔 ' + t.of + '건 중 ' + t.n + '건'; o.src = 'hist'; continue; }
    if (hist.length) { const t = top(hist.map(h => h.scan)); o.box = t.box; o.how = '구성이력-다른 날 스캔 ' + t.of + '건 중 ' + t.n + '건'; o.src = 'hist'; continue; }
    const ph = past[o.combo];
    if (ph) { let best = '', n = 0, of = 0; for (const b in ph) { of += ph[b]; if (ph[b] > n) { best = b; n = ph[b]; } } o.box = best; o.how = '구성이력-다른 날 스캔 ' + of + '건 중 ' + n + '건'; o.src = 'hist'; continue; }
    const near = o.vol > 0 ? byVol.slice().sort((a, b) => Math.abs(a.vol - o.vol) - Math.abs(b.vol - o.vol)).slice(0, 7) : [];
    if (near.length) { const t = top(near.map(h => h.scan)); o.box = t.box; o.how = '예측-비슷한 부피 ' + t.of + '건 중 ' + t.n + '건(참고용)'; o.src = 'pred'; }
    else { o.box = '기타'; o.how = '판정 불가'; o.src = 'none'; }
  }
  for (const o of all) {
    const tag = o.box === '송장부착';
    o.boxN = tag ? 0 : 1; o.single = !tag && o.nsku === 1 && o.qty === 1 ? 1 : 0;
    o.same = !tag && o.nsku === 1 && o.qty !== 1 ? 1 : 0; o.mixed = !tag && o.nsku >= 2 ? 1 : 0;
  }
  const byPack = new Map(), byOrder = new Map();
  for (const o of all) {
    if (o.qty === 0) continue;
    if (o.pack && (!byPack.has(o.pack) || o.inv < byPack.get(o.pack).inv)) byPack.set(o.pack, o);
    if (o.order && (!byOrder.has(o.order) || o.inv < byOrder.get(o.order).inv)) byOrder.set(o.order, o);
  }
  for (const o of all) {
    if (o.qty !== 0 || o.box === '송장부착') continue;
    const m = (o.pack && byPack.get(o.pack)) || (o.order && byOrder.get(o.order));
    o.add = true; o.orig = m ? m.inv : '';
    o.single = m ? m.single : 0; o.same = m ? m.same : 1; o.mixed = m ? m.mixed : 0;
  }
  all.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.inv < b.inv ? -1 : 1));
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
  res.invoices.filter(o => o.temp === '저온').forEach(o => {
    if (!m.has(o.combo)) m.set(o.combo, BOXES.map(() => 0).concat([0, 0]));
    const a = m.get(o.combo), i = BOXES.indexOf(o.box);
    a[i >= 0 ? i : 7]++; a[8]++;
  });
  return [...m.entries()].map(([combo, cells]) => {
    let mi = 0; cells.slice(0, 8).forEach((n, i) => { if (n > cells[mi]) mi = i; });
    return { combo, cells, main: cells[8] ? (mi < 7 ? BOXES[mi] : '기타') : '' };
  }).sort((a, b) => b.cells[8] - a.cells[8]);
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
const YEL = solid('FFFFF2CC');

function monthDays(res) {
  const d = res.invoices.map(o => o.day).filter(Boolean).sort();
  if (!d.length) return [];
  const [y, m] = d[0].split('-').map(Number), n = new Date(Date.UTC(y, m, 0)).getUTCDate(), out = [];
  for (let i = 1; i <= n; i++) out.push(y + '-' + String(m).padStart(2, '0') + '-' + String(i).padStart(2, '0'));
  return out;
}

export function addSheets(wb, res) {
  const inv = res.invoices.slice().sort((a, b) => (a.day + a.temp + a.ch + a.inv < b.day + b.temp + b.ch + b.inv ? -1 : 1));
  const L = inv.length + 1, rg = c => '통합!$' + c + '$2:$' + c + '$' + L;
  // 통합
  const ws = wb.addWorksheet('통합', { views: [{ state: 'frozen', ySplit: 1 }] });
  ['등록일시', '온도구분', '판매채널명', '송장번호', '상품명 개수', '수량 합계', '박스', '박스판정', '박스수', '동종합포', '이종합포', '송장부착', '채널구분', '구성(상품명 x수량)', '출고할당명', '단포'].forEach((h, j) => put(ws, 1, j + 1, h, ST.hd));
  inv.forEach((o, k) => {
    const r = k + 2, y = o.src !== 'scan', tag = o.box === '송장부착';
    const vals = [serial(o.day), o.temp, o.ch, o.inv, o.nsku, o.qty, o.box, o.how,
      { formula: 'IF($G' + r + '="송장부착",0,LEN($D' + r + ')-LEN(SUBSTITUTE($D' + r + ',",",""))+1)', result: o.boxN },
      o.add ? o.same : { formula: 'IF($G' + r + '="송장부착",0,IF(AND($E' + r + '=1,$F' + r + '<>1),1,0))', result: o.same },
      o.add ? o.mixed : { formula: 'IF($G' + r + '="송장부착",0,IF($E' + r + '>=2,1,0))', result: o.mixed },
      { formula: 'IF($G' + r + '="송장부착",1,0)', result: tag ? 1 : 0 },
      o.chg, o.combo, o.alloc,
      o.add ? o.single : { formula: 'IF($G' + r + '="송장부착",0,IF(AND($E' + r + '=1,$F' + r + '=1),1,0))', result: o.single }];
    vals.forEach((v, j) => { const c = put(ws, r, j + 1, v, j === 0 ? ST.date : ST.txt); if (y) c.fill = YEL; if (j === 3 || j >= 13 && j <= 14) c.quotePrefix = true; });
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
  block(sheetOf('직영몰_도착보장_저온', true), 1, '직영몰 스마트스토어 + 직영몰 스마트스토어(도착보장) - 저온 · 아이스박스', crit('M', '직영몰(도착보장)'), o => o.chg === '직영몰(도착보장)');
  const gen = sheetOf('일반_저온', false), cnt = {};
  inv.filter(o => o.chg === '일반' && o.temp === '저온').forEach(o => { cnt[o.ch] = (cnt[o.ch] || 0) + 1; });
  const chans = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
  let top = 1;
  chans.forEach(c => { top = block(gen, top, c + ' - 저온 · 아이스박스', crit('C', c), o => o.chg === '일반' && o.ch === c) + 2; });
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
