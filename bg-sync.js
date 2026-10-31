// 빙그레 페이지 실시간 공유 (마감쓰와 같은 Firebase, 별도 경로 /bg)
(function () {
  const ROOT = "bg", K_URL = "bg_sync_url", K_NAME = "bg_sync_name", K_DEV = "mw_sync_dev";
  const enc = k => String(k).replace(/[%.#$\[\]\/]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
  const dec = k => { try { return decodeURIComponent(k); } catch (e) { return k; } };
  let dev = localStorage.getItem(K_DEV);
  if (!dev) { dev = "d" + Math.random().toString(36).slice(2, 10); localStorage.setItem(K_DEV, dev); }
  let es = null, mirror = {}, ready = false, st = { state: "off", msg: "" };
  const dataL = new Set(), stL = new Set(), q = {};
  let qTimer = null, retryTimer = null;
  const base = () => { const v = localStorage.getItem(K_URL); return (v !== null ? v : (localStorage.getItem("mw_sync_url") || "")).trim().replace(/\/+$/, ""); };
  const name = () => localStorage.getItem(K_NAME) || localStorage.getItem("mw_sync_name") || "";
  const setSt = (state, msg) => { st = { state, msg: msg || "" }; stL.forEach(f => { try { f(st); } catch (e) {} }); };
  const split = p => String(p || "").split("/").filter(Boolean);
  function setAt(parts, data) {
    if (!parts.length) { mirror = (data && typeof data === "object") ? data : {}; return; }
    let o = mirror;
    for (let i = 0; i < parts.length - 1; i++) { if (!o[parts[i]] || typeof o[parts[i]] !== "object") o[parts[i]] = {}; o = o[parts[i]]; }
    const l = parts[parts.length - 1];
    if (data == null) delete o[l]; else o[l] = data;
  }
  function onEvt(kind, raw) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m) return;
    const parts = split(m.path);
    if (kind === "put") { setAt(parts, m.data); if (!parts.length) Object.keys(q).forEach(k => setAt(split(k), q[k])); }
    else Object.keys(m.data || {}).forEach(k => setAt(parts.concat(split(k)), m.data[k]));
    const initial = !ready; ready = true;
    if (st.state !== "on") setSt("on");
    dataL.forEach(f => { try { f(initial); } catch (e) { console.error(e); } });
  }
  function stop() { if (es) { es.close(); es = null; } ready = false; }
  function start() {
    stop();
    const b = base();
    if (!b) { setSt("off"); return; }
    setSt("connecting", "연결 중…");
    fetch(b + "/" + ROOT + ".json?shallow=true").then(r => {
      if (r.status === 401 || r.status === 403) { stop(); setSt("error", "권한이 없습니다. Firebase 규칙에 \"bg\"를 추가해 주세요"); }
    }).catch(() => {});
    try { es = new EventSource(b + "/" + ROOT + ".json"); } catch (e) { setSt("error", "주소가 올바르지 않습니다"); return; }
    es.addEventListener("put", e => onEvt("put", e.data));
    es.addEventListener("patch", e => onEvt("patch", e.data));
    es.addEventListener("cancel", () => setSt("error", "권한이 없습니다. 데이터베이스 규칙에 bg를 추가하세요"));
    es.onerror = () => { if (st.state !== "error") setSt("connecting", "재연결 중…"); };
    flush();
  }
  function queue(path, val) { setAt(split(path), val); q[path] = val; clearTimeout(qTimer); qTimer = setTimeout(flush, 150); }
  async function flush() {
    const b = base(), keys = Object.keys(q);
    if (!b || !keys.length) return;
    const body = {}; keys.forEach(k => { body[k] = q[k]; delete q[k]; });
    try {
      const r = await fetch(b + "/" + ROOT + ".json", { method: "PATCH", body: JSON.stringify(body) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      if (st.state === "error" && ready) setSt("on");
    } catch (e) {
      keys.forEach(k => { if (!(k in q)) q[k] = body[k]; });
      setSt("error", "저장 실패, 5초 뒤 다시 시도합니다 (" + e.message + ")");
      clearTimeout(retryTimer); retryTimer = setTimeout(flush, 5000);
    }
  }
  const put = (coll, obj) => queue(coll + "/" + enc(obj.id), JSON.stringify(obj));
  const del = (coll, id) => queue(coll + "/" + enc(id), null);
  function list(coll) {
    const o = mirror[coll] || {};
    if (typeof o !== "object") return [];
    return Object.keys(o).map(k => { try { return JSON.parse(o[k]); } catch (e) { return null; } }).filter(Boolean);
  }
  async function configure(url, nm) {
    url = String(url || "").trim().replace(/\/+$/, "");
    if (!/^https:\/\/[^\/]+\.(firebaseio\.com|firebasedatabase\.app)$/.test(url))
      return { ok: false, msg: "Firebase Realtime Database 주소(https://…firebaseio.com 또는 …firebasedatabase.app)를 넣어주세요" };
    try {
      const r = await fetch(url + "/" + ROOT + ".json?shallow=true");
      if (r.status === 401 || r.status === 403) return { ok: false, msg: "읽기 권한이 없습니다. 규칙에 \"bg\"를 추가해 게시했는지 확인하세요" };
      if (!r.ok) return { ok: false, msg: "연결 실패 (HTTP " + r.status + ")" };
    } catch (e) { return { ok: false, msg: "연결 실패: " + e.message }; }
    localStorage.setItem(K_URL, url);
    localStorage.setItem(K_NAME, String(nm || "").trim());
    start();
    return { ok: true };
  }
  function disconnect() { stop(); localStorage.setItem(K_URL, ""); setSt("off"); }
  // 관리자: 공용 비밀번호를 아는 사람이 입력하면 그 컴퓨터가 관리자가 됨. 비밀번호 변경은 현재 비밀번호가 있어야 가능
  const K_ADM = "bg_admin_hash";
  async function sha(s) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("bg-owner:" + s)); return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, "0")).join(""); }
  const isOwner = () => !!mirror.ownerPin && localStorage.getItem(K_ADM) === mirror.ownerPin;
  const notify = () => dataL.forEach(f => { try { f(false); } catch (e) {} });
  const okPin = p => /^\d{4,8}$/.test(String(p || ""));
  async function login(pin) {
    if (!mirror.ownerPin) return { ok: false, msg: "아직 관리자 비밀번호가 없습니다" };
    const h = await sha(pin);
    if (h !== mirror.ownerPin) return { ok: false, msg: "비밀번호가 맞지 않습니다" };
    localStorage.setItem(K_ADM, h); notify(); return { ok: true };
  }
  function logout() { localStorage.removeItem(K_ADM); notify(); }
  async function setPin(cur, next) {
    if (!base() || !ready) return { ok: false, msg: "공유를 먼저 연결하세요" };
    if (mirror.ownerPin && (await sha(cur)) !== mirror.ownerPin) return { ok: false, msg: "현재 비밀번호가 맞지 않습니다" };
    if (!okPin(next)) return { ok: false, msg: "새 비밀번호는 숫자 4~8자리로 정해주세요" };
    const h = await sha(next);
    queue("ownerPin", h); localStorage.setItem(K_ADM, h); notify(); return { ok: true };
  }
  window.BgSync = {
    setPin, login, logout, isOwner, hasPin: () => !!mirror.ownerPin,
    start, configure, disconnect, put, del, list, url: base, name, dev: () => dev, ready: () => ready, status: () => st, dec,
    onStatus: f => { stL.add(f); return () => stL.delete(f); },
    onData: f => { dataL.add(f); return () => dataL.delete(f); }
  };
})();
