// 빙그레 일반 작업료 집계 — 계산 · 압축 · 엑셀 생성
export const KINDS = ['단포', '동종 합포', '이종 합포'];
const NEED = ['송장번호', '상품코드', '주문수량', '배송사 명', '포장지시일'];

function toDay(v) {
  if (v instanceof Date && !isNaN(v)) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  if (typeof v === 'number' && isFinite(v)) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const m = String(v || '').match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
export const dayKey = d => d ? d.toISOString().slice(0, 10) : '';
const str = v => (v == null ? '' : String(v)).trim();
const ARR_CH = ['직영몰스마트스토어', '직영몰스마트스토어(도착보장)'];
const gubOf = (carrier, ch) => carrier.includes('도착') || ARR_CH.includes(str(ch).replace(/\s+/g, '')) ? '도착보장' : '일반';

export function compute(rows) {
  const hi = Math.max(0, rows.slice(0, 10).findIndex(r => (r || []).some(c => str(c) === '송장번호')));
  const head = (rows[hi] || []).map(str);
  const col = {};
  head.forEach((h, i) => { if (!(h in col)) col[h] = i; });
  const missing = NEED.filter(h => !(h in col));
  if (missing.length) throw new Error('필요한 열이 없습니다: ' + missing.join(', ') + ' · 출고내역서(통합관리 엑셀)인지 확인하세요');
  const g = (r, h) => (h in col ? r[col[h]] : '');
  const chH = ['판매 채널명', '판매채널명', '채널명'].find(h => h in col) || head.find(h => h.replace(/\s+/g, '').includes('채널명')) || '';
  const map = new Map();
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const inv = str(g(r, '송장번호'));
    if (!inv) continue;
    let o = map.get(inv);
    if (!o) {
      const carrier = str(g(r, '배송사 명'));
      o = { inv, day: toDay(g(r, '포장지시일')), carrier, gub: gubOf(carrier, chH ? g(r, chH) : ''),
        pack: str(g(r, '합포장 번호')), order: str(g(r, '쇼핑몰 주문번호')), skus: new Set(), qty: 0 };
      map.set(inv, o);
    }
    o.skus.add(str(g(r, '상품코드')));
    const q = parseFloat(String(g(r, '주문수량')).replace(/,/g, ''));
    if (isFinite(q)) o.qty += q;
  }
  const all = [...map.values()];
  if (!all.length) throw new Error('송장 데이터가 없습니다. 출고내역서 파일인지 확인해 주세요.');
  const byPack = new Map(), byOrder = new Map();
  for (const o of all) {
    o.nsku = o.skus.size;
    if (o.qty === 0) continue;
    o.kind = o.nsku > 1 ? '이종 합포' : (o.qty === 1 ? '단포' : '동종 합포');
    o.type = '원송장'; o.orig = null;
    if (o.pack && (!byPack.has(o.pack) || o.inv < byPack.get(o.pack).inv)) byPack.set(o.pack, o);
    if (o.order && (!byOrder.has(o.order) || o.inv < byOrder.get(o.order).inv)) byOrder.set(o.order, o);
  }
  let notFound = 0;
  for (const o of all) {
    if (o.qty !== 0) continue;
    o.type = '추가송장';
    const m = (o.pack && byPack.get(o.pack)) || (o.order && byOrder.get(o.order));
    if (m) { o.kind = m.kind; o.orig = m.inv; } else { o.kind = '동종 합포'; o.orig = '(못 찾음)'; notFound++; }
  }
  const gubOrd = { '도착보장': 0, '일반': 1 };
  all.sort((a, b) => (dayKey(a.day) < dayKey(b.day) ? -1 : dayKey(a.day) > dayKey(b.day) ? 1 : 0)
    || gubOrd[a.gub] - gubOrd[b.gub] || (a.inv < b.inv ? -1 : a.inv > b.inv ? 1 : 0));
  return { invoices: all, rowCount: rows.length - hi - 1, addCount: all.filter(o => o.type === '추가송장').length, notFound };
}

export function monthOf(res) {
  const cnt = {};
  res.invoices.forEach(o => { if (o.day) { const k = dayKey(o.day).slice(0, 7); cnt[k] = (cnt[k] || 0) + 1; } });
  return Object.keys(cnt).sort((x, y) => cnt[y] - cnt[x])[0] || '';
}

export function pack(res) {
  const cs = [], ci = new Map();
  const lines = res.invoices.map(o => {
    let c = ci.get(o.carrier); if (c == null) { c = cs.length; cs.push(o.carrier); ci.set(o.carrier, c); }
    return [o.inv, dayKey(o.day), c, o.nsku, o.qty, KINDS.indexOf(o.kind), o.type === '추가송장' ? 1 : 0, o.orig || '', o.gub === '도착보장' ? 1 : 0].join('\t');
  });
  return { rowCount: res.rowCount, addCount: res.addCount, notFound: res.notFound, carriers: cs, packed: lines.join('\n') };
}
export function unpack(rec) {
  const cs = rec.carriers || [];
  const invoices = String(rec.packed || '').split('\n').filter(Boolean).map(l => {
    const a = l.split('\t'), carrier = cs[+a[2]] || '';
    return { inv: a[0], day: a[1] ? new Date(a[1] + 'T00:00:00Z') : null, carrier, gub: a[8] != null ? (a[8] === '1' ? '도착보장' : '일반') : gubOf(carrier, ''),
      nsku: +a[3], qty: +a[4], kind: KINDS[+a[5]] || '단포', type: a[6] === '1' ? '추가송장' : '원송장', orig: a[7] || null };
  });
  return { invoices, rowCount: rec.rowCount || 0, addCount: rec.addCount || 0, notFound: rec.notFound || 0 };
}

export function summarize(res, price) {
  const out = {};
  for (const gub of ['일반', '도착보장']) {
    const list = res.invoices.filter(o => o.gub === gub);
    const s = { gub, add: 0, days: new Map() };
    KINDS.forEach(k => s[k] = 0);
    for (const o of list) {
      s[o.kind]++; if (o.type === '추가송장') s.add++;
      const k = dayKey(o.day);
      if (!s.days.has(k)) s.days.set(k, { day: o.day, '단포': 0, '동종 합포': 0, '이종 합포': 0, add: 0 });
      const d = s.days.get(k); d[o.kind]++; if (o.type === '추가송장') d.add++;
    }
    s.total = KINDS.reduce((a, k) => a + s[k], 0);
    s.amount = KINDS.reduce((a, k) => a + s[k] * price[k], 0);
    s.days = [...s.days.values()].sort((a, b) => (a.day || 0) - (b.day || 0));
    s.vat = s.days.reduce((a, d) => a + Math.round(KINDS.reduce((x, k) => x + d[k] * price[k], 0) * 1.1), 0);
    out[gub] = s;
  }
  return out;
}

export async function buildWorkbook(ExcelJS, res, price) {
  const sum = summarize(res, price);
  const wb = new ExcelJS.Workbook();
  const FN = '맑은 고딕', thin = { style: 'thin' }, B = { top: thin, left: thin, bottom: thin, right: thin };
  const GRAY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
  const YEL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
  const NUM = '#,##0';
  const cell = (ws, r, c, v, o = {}) => {
    const x = ws.getCell(r, c); x.value = v;
    x.font = { name: FN, size: 10, bold: !!o.bold }; x.border = B;
    x.alignment = { horizontal: 'center', vertical: 'middle' };
    if (o.fmt) x.numFmt = o.fmt; if (o.fill) x.fill = o.fill;
    return x;
  };
  const L = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const F = (formula, result) => ({ formula, result });
  const S = wb.addWorksheet('요약', { views: [{ showGridLines: false }] });
  const D1 = wb.addWorksheet('일반 (CJ대한통운)', { views: [{ state: 'frozen', xSplit: 1, ySplit: 2, showGridLines: false }] });
  const D2 = wb.addWorksheet('도착보장', { views: [{ state: 'frozen', xSplit: 1, ySplit: 2, showGridLines: false }] });
  const D = wb.addWorksheet('송장별 분류', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  const hd = ['송장번호', '포장지시일', '배송사 명', '구분', '상품 종수', '총 수량', '분류', '송장구분', '원송장번호'];
  hd.forEach((h, j) => cell(D, 1, j + 1, h, { bold: true, fill: GRAY }));
  res.invoices.forEach((o, i) => {
    [o.inv, o.day, o.carrier, o.gub, o.nsku, o.qty, o.kind, o.type, o.orig]
      .forEach((v, j) => cell(D, i + 2, j + 1, v, j === 1 ? { fmt: 'yyyy-mm-dd' } : {}));
  });
  [16, 12, 30, 10, 9, 9, 11, 10, 16].forEach((w, j) => D.getColumn(j + 1).width = w);
  const n = res.invoices.length + 1;
  D.autoFilter = `A1:I${n}`;
  const rng = c => `'송장별 분류'!$${c}$2:$${c}$${n}`;
  S.getCell('A1').value = '일반 작업료 집계 (빙그레)';
  S.getCell('A1').font = { name: FN, size: 14, bold: true };
  cell(S, 3, 1, '구분', { bold: true, fill: GRAY }); cell(S, 3, 2, '단가 (vat 별도)', { bold: true, fill: GRAY });
  KINDS.forEach((k, i) => { cell(S, 4 + i, 1, k); cell(S, 4 + i, 2, price[k], { fmt: NUM, fill: YEL }); });
  ['* 단가는 견적서(2026-10-22) 기준. 노란 칸을 바꾸면 전체가 다시 계산됩니다.',
    '* 분류(송장 1건): 상품 1종·수량 1개=단포 / 같은 상품 2개 이상=동종 합포 / 상품 2종 이상=이종 합포. 일자=포장지시일.',
    '* 추가송장(주문수량 0): 합포장 번호가 같은 원송장의 분류를 따라 1건으로 집계. 건수는 추가송장 포함.']
    .forEach((t, i) => { const c = S.getCell(8 + i, 1); c.value = t; c.font = { name: FN, size: 9 }; });
  const P = { '단포': '요약!$B$4', '동종 합포': '요약!$B$5', '이종 합포': '요약!$B$6' };
  const daily = (ws, gub) => {
    const s = sum[gub];
    const cols = ['일자', '단포', '동종 합포', '이종 합포', '합계 건수', '추가송장 (포함)', '단포 금액', '동종 합포 금액', '이종 합포 금액', '합계 (vat 별도)', '합계 (vat 포함)'];
    for (let c = 1; c <= 11; c++) cell(ws, 1, c, null, { fill: GRAY });
    ws.mergeCells('B1:F1'); ws.mergeCells('G1:K1');
    ws.getCell('B1').value = '건수'; ws.getCell('G1').value = '금액 (원)';
    ws.getCell('B1').font = ws.getCell('G1').font = { name: FN, size: 10, bold: true };
    cols.forEach((h, j) => cell(ws, 2, j + 1, h, { bold: true, fill: GRAY }));
    let r = 3;
    for (const d of s.days) {
      cell(ws, r, 1, d.day, { fmt: 'yyyy-mm-dd' });
      let amt = 0, cnt = 0;
      KINDS.forEach((k, j) => {
        cell(ws, r, j + 2, F(`COUNTIFS(${rng('B')},$A${r},${rng('D')},"${gub}",${rng('G')},"${k}")`, d[k]), { fmt: NUM });
        cell(ws, r, j + 7, F(`${L(j + 2)}${r}*${P[k]}`, d[k] * price[k]), { fmt: NUM });
        amt += d[k] * price[k]; cnt += d[k];
      });
      cell(ws, r, 5, F(`SUM(B${r}:D${r})`, cnt), { fmt: NUM });
      cell(ws, r, 6, F(`COUNTIFS(${rng('B')},$A${r},${rng('D')},"${gub}",${rng('H')},"추가송장")`, d.add), { fmt: NUM });
      cell(ws, r, 10, F(`SUM(G${r}:I${r})`, amt), { fmt: NUM });
      cell(ws, r, 11, F(`ROUND(J${r}*1.1,0)`, Math.round(amt * 1.1)), { fmt: NUM });
      r++;
    }
    const tot = [null, s['단포'], s['동종 합포'], s['이종 합포'], s.total, s.add,
      s['단포'] * price['단포'], s['동종 합포'] * price['동종 합포'], s['이종 합포'] * price['이종 합포'], s.amount, s.vat];
    cell(ws, r, 1, '합계', { bold: true, fill: GRAY });
    for (let c = 2; c <= 11; c++) cell(ws, r, c, F(`SUM(${L(c)}3:${L(c)}${r - 1})`, tot[c - 1]), { bold: true, fmt: NUM, fill: GRAY });
    [12, 8, 10, 10, 10, 12, 11, 14, 14, 15, 15].forEach((w, j) => ws.getColumn(j + 1).width = w);
    return { r };
  };
  const t1 = daily(D1, '일반'), t2 = daily(D2, '도착보장');
  ['구분', '단포', '동종 합포', '이종 합포', '합계 건수', '추가송장 (포함)', '합계 (vat 별도)', '합계 (vat 포함)']
    .forEach((h, j) => cell(S, 12, j + 1, h, { bold: true, fill: GRAY }));
  [['일반', D1, t1], ['도착보장', D2, t2]].forEach(([gub, ws, t], i) => {
    const r = 13 + i, s = sum[gub], q = `'${ws.name}'!`;
    cell(S, r, 1, gub);
    const vals = [s['단포'], s['동종 합포'], s['이종 합포'], s.total, s.add, s.amount, s.vat];
    ['B', 'C', 'D', 'E', 'F', 'J', 'K'].forEach((c, j) => cell(S, r, j + 2, F(`${q}${c}${t.r}`, vals[j]), { fmt: NUM }));
  });
  cell(S, 15, 1, '총계', { bold: true, fill: GRAY });
  for (let c = 2; c <= 8; c++) {
    const v = (S.getCell(13, c).value.result || 0) + (S.getCell(14, c).value.result || 0);
    cell(S, 15, c, F(`SUM(${L(c)}13:${L(c)}14)`, v), { bold: true, fmt: NUM, fill: GRAY });
  }
  [12, 14, 10, 10, 10, 13, 15, 15].forEach((w, j) => S.getColumn(j + 1).width = w);
  return await wb.xlsx.writeBuffer();
}
