/* Modern Taekwondo Attendance - PWA
   Data is stored on the phone (IndexedDB). Backup / Excel / Google Sheets sync are in Settings. */
(() => {
'use strict';

/* ============ helpers ============ */
const APP_VERSION = '1.1.0';
const TZ = 'Asia/Kuala_Lumpur';
const DB_NAME = 'mt-attendance', STORE = 'kv', KEY = 'data';
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MON3 = MONTHS.map(m => m.slice(0, 3));
const DOWS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const $ = (s, r = document) => r.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clone = o => JSON.parse(JSON.stringify(o));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function nowKL() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = t => p.find(x => x.type === t).value;
  let h = g('hour'); if (h === '24') h = '00';
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${h}:${g('minute')}` };
}
const parseDate = d => d.split('-').map(Number);
const dowOf = d => { const [y, m, dd] = parseDate(d); return new Date(Date.UTC(y, m - 1, dd)).getUTCDay(); };
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const fmtDateLong = d => { const [y, m, dd] = parseDate(d); return `${DOWS[dowOf(d)]}, ${dd} ${MONTHS[m - 1]} ${y}`; };
const fmtDateShort = d => { const [y, m, dd] = parseDate(d); return `${pad(dd)}-${MON3[m - 1]}-${y}`; };
const fmtTime = t => { if (!t) return ''; const [h, mi] = t.split(':').map(Number); return `${h % 12 || 12}:${pad(mi)} ${h >= 12 ? 'PM' : 'AM'}`; };
const periodLabel = p => p.type === 'all' ? 'All time' : p.type === 'year' ? String(p.y) : `${MONTHS[p.m - 1]} ${p.y}`;
const ago = ts => { if (!ts) return 'never'; const d = Math.floor((Date.now() - ts) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; };
const agoLong = ts => { if (!ts) return 'never'; const m = Math.floor((Date.now() - ts) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.floor(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago'); const d = Math.floor(h / 24); return d === 1 ? '1 day ago' : d + ' days ago'; };
const fmtStamp = ts => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ts)).replace(/\b(am|pm)\b/, x => x.toUpperCase());

const ICON = {
  school: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  gear: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  left: '<polyline points="15 18 9 12 15 6"/>',
  right: '<polyline points="9 18 15 12 9 6"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'
};
const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ============ data ============ */
let data;
function emptyData() {
  return { v: 1, schools: [], students: [], sessions: [], coaches: [], syncLog: {}, deleted: {},
    settings: { coach: '', coachId: '', sheetsUrl: '', sheetsKey: '', weekStart: 0, lastBackup: 0, lastSync: 0 } };
}
function normalize(d) {
  const e = emptyData();
  const o = Object.assign(e, d || {});
  o.settings = Object.assign(emptyData().settings, (d && d.settings) || {});
  ['schools', 'students', 'sessions', 'coaches'].forEach(k => { if (!Array.isArray(o[k])) o[k] = []; });
  if (!o.deleted || typeof o.deleted !== 'object') o.deleted = {};
  if (!o.syncLog || typeof o.syncLog !== 'object') o.syncLog = {};
  o.sessions.forEach(s => { if (!s.marks) s.marks = {}; });
  return o;
}
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) {
  const db = await idbOpen();
  return new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function idbSet(k, v) {
  const db = await idbOpen();
  return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
async function loadData() {
  try { const v = await idbGet(KEY); if (v) return normalize(v); } catch (e) { /* fall through */ }
  try { const s = localStorage.getItem(KEY); if (s) return normalize(JSON.parse(s)); } catch (e) { /* ignore */ }
  return emptyData();
}
let saveTimer;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 150); }
async function flush() {
  clearTimeout(saveTimer);
  try { await idbSet(KEY, data); }
  catch (e) { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e2) { toast('Could not save! Please make a backup now.'); } }
}
const touch = o => { o.updatedAt = Date.now(); return o; };

/* ---- queries ---- */
const sortedSchools = () => [...data.schools].sort((a, b) => collator.compare(a.name, b.name));
const sortedStudents = sid => data.students.filter(s => s.schoolId === sid).sort((a, b) => collator.compare(a.name, b.name));
const getSchool = id => data.schools.find(s => s.id === id);
const getStudent = id => data.students.find(s => s.id === id);
const getSession = id => data.sessions.find(s => s.id === id);
const getCoach = id => data.coaches.find(c => c.id === id);
const myCoachName = () => { const c = getCoach(data.settings.coachId); return c ? c.name : ''; };
const sortedCoaches = () => [...data.coaches].sort((a, b) => collator.compare(a.name, b.name));
const isDev = sc => !!sc && sc.type === 'dev';
function classLinks() {
  const m = new Map();
  data.students.forEach(st => {
    const sc = getSchool(st.schoolId); if (!sc) return;
    const k = norm(st.name), e = m.get(k) || { b: 0, d: 0 };
    if (isDev(sc)) e.d++; else e.b++;
    m.set(k, e);
  });
  return m;
}
const isBoth = (st, links) => { const e = links.get(norm(st.name)); return !!(e && e.b && e.d); };
const cmpSession = (a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));
const sessionsOfSchool = sid => data.sessions.filter(s => s.schoolId === sid).sort(cmpSession);
function inPeriod(date, p) {
  if (p.type === 'all') return true;
  if (p.type === 'year') return date.slice(0, 4) === String(p.y);
  return date.slice(0, 7) === `${p.y}-${pad(p.m)}`;
}
const sessionsFor = (sid, p) => sessionsOfSchool(sid).filter(s => inPeriod(s.date, p));
function studentStats(st, sessions) {
  let att = 0, tot = 0;
  for (const s of sessions) {
    if (s.holiday) continue;
    const m = s.marks && s.marks[st.id];
    if (m === true) { att++; tot++; } else if (m === false) tot++;
  }
  return { att, tot, pct: tot ? Math.round(att * 100 / tot) : null };
}
const countMarks = s => { let p = 0, a = 0; for (const k in s.marks) { if (s.marks[k] === true) p++; else if (s.marks[k] === false) a++; } return { p, a }; };

/* ---- delete with tombstones (so merging between phones works) ---- */
function tomb(id) { data.deleted[id] = Date.now(); }
function deleteStudent(id) {
  data.students = data.students.filter(s => s.id !== id); tomb(id);
  data.sessions.forEach(s => { if (s.marks && id in s.marks) { delete s.marks[id]; touch(s); } });
}
function deleteSession(id) { data.sessions = data.sessions.filter(s => s.id !== id); tomb(id); }
function deleteSchool(id) {
  data.students.filter(s => s.schoolId === id).forEach(s => tomb(s.id));
  data.sessions.filter(s => s.schoolId === id).forEach(s => tomb(s.id));
  data.students = data.students.filter(s => s.schoolId !== id);
  data.sessions = data.sessions.filter(s => s.schoolId !== id);
  data.schools = data.schools.filter(s => s.id !== id); tomb(id);
}

/* ---- merge (used by Restore->Merge and Google Sheets sync) ---- */
function mergeData(local, remote) {
  const out = clone(local);
  out.deleted = Object.assign({}, remote.deleted || {}, local.deleted || {});
  for (const k in (remote.deleted || {})) out.deleted[k] = Math.max(out.deleted[k] || 0, remote.deleted[k]);
  const mergeList = (a, b) => {
    const m = new Map();
    for (const x of a) m.set(x.id, x);
    for (const x of b) { const y = m.get(x.id); if (!y || (x.updatedAt || 0) > (y.updatedAt || 0)) m.set(x.id, x); }
    return [...m.values()].filter(x => !(out.deleted[x.id] && out.deleted[x.id] >= (x.updatedAt || 0)));
  };
  out.schools = mergeList(local.schools, remote.schools || []);
  out.students = mergeList(local.students, remote.students || []);
  out.sessions = mergeList(local.sessions, remote.sessions || []);
  out.coaches = mergeList(local.coaches || [], remote.coaches || []);
  out.syncLog = Object.assign({}, remote.syncLog || {}, local.syncLog || {});
  for (const k in (remote.syncLog || {})) out.syncLog[k] = Math.max(out.syncLog[k] || 0, remote.syncLog[k]);
  const sc = new Set(out.schools.map(s => s.id));
  out.students = out.students.filter(s => sc.has(s.schoolId));
  out.sessions = out.sessions.filter(s => sc.has(s.schoolId));
  const st = new Set(out.students.map(s => s.id));
  out.sessions.forEach(s => { for (const k in s.marks) if (!st.has(k)) delete s.marks[k]; });
  return out;
}
const dataForShare = () => ({ v: 1, schools: data.schools, students: data.students, sessions: data.sessions, coaches: data.coaches, syncLog: data.syncLog, deleted: data.deleted });
function applyMerged(m) { data.schools = m.schools; data.students = m.students; data.sessions = m.sessions; data.deleted = m.deleted; data.coaches = m.coaches; data.syncLog = m.syncLog; }

/* ============ UI state ============ */
const today0 = nowKL();
const ui = {
  tab: 'schools', schoolId: null, sub: 'students',
  q: '', sq: '',
  cal: { y: +today0.date.slice(0, 4), m: +today0.date.slice(5, 7) }, selDate: today0.date,
  period: { type: 'month', y: +today0.date.slice(0, 4), m: +today0.date.slice(5, 7) },
  exp: { schoolId: 'all', studentId: 'all', period: { type: 'all', y: +today0.date.slice(0, 4), m: +today0.date.slice(5, 7) } },
  take: null, installEvt: null
};

const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`).join('');
const monthOpts = sel => opts(MONTHS.map((m, i) => [i + 1, m]), sel);
function yearList() {
  const cy = +nowKL().date.slice(0, 4); let lo = cy - 1, hi = cy + 1;
  data.sessions.forEach(s => { const y = +s.date.slice(0, 4); if (y < lo) lo = y; if (y > hi) hi = y; });
  const l = []; for (let y = lo; y <= hi; y++) l.push([y, y]); return l;
}
function periodControls(prefix) {
  const p = prefix.split('.').reduce((o, k) => o[k], ui);
  return `<div class="row period">
    <select data-bind="${prefix}.type" data-rerender="1" aria-label="Period">${opts([['month', 'Month'], ['year', 'Whole year'], ['all', 'All time']], p.type)}</select>
    ${p.type === 'month' ? `<select data-bind="${prefix}.m" data-num="1" data-rerender="1" aria-label="Month">${monthOpts(p.m)}</select>` : ''}
    ${p.type !== 'all' ? `<select data-bind="${prefix}.y" data-num="1" data-rerender="1" aria-label="Year">${opts(yearList(), p.y)}</select>` : ''}
  </div>`;
}

/* ============ views ============ */
function topbar(title, sub, back) {
  return `<div class="topbar">
    ${back ? `<button class="iconbtn" data-act="${back}" aria-label="Back">${icon('left')}</button>` : `<img src="logo-emblem.png" alt="">`}
    <div class="grow"><h1>${esc(title)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
  </div>`;
}
function navHTML() {
  const t = (id, ic, label) => `<button class="${ui.tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}">${icon(ic)}<span>${label}</span></button>`;
  return `<nav class="nav"><div class="in">${t('schools', 'school', 'Schools')}${t('overview', 'chart', 'Overview')}${t('settings', 'gear', 'Settings')}</div></nav>`;
}

/* ---- Schools ---- */
function schoolsListHTML() {
  const q = norm(ui.q);
  if (q) {
    const sch = sortedSchools().filter(s => norm(s.name).includes(q));
    const stu = data.students.filter(s => norm(s.name).includes(q)).sort((a, b) => collator.compare(a.name, b.name));
    if (!sch.length && !stu.length) return `<div class="empty">No school or student found.</div>`;
    const rows = sch.map(sc => { const n = data.students.filter(s => s.schoolId === sc.id).length;
      return `<button class="item" data-act="openSchool" data-id="${sc.id}">
        <div class="grow"><div class="t">${esc(sc.name)}</div><div class="s">${isDev(sc) ? 'Development class · ' : ''}${n} student${n === 1 ? '' : 's'}</div></div><span class="pill gold">School</span><span class="chev">${icon('right')}</span></button>`; })
      .concat(stu.map(s => { const sc = getSchool(s.schoolId);
      return `<button class="item" data-act="openSchool" data-id="${s.schoolId}" data-sub="students" data-open="${s.id}">
        <div class="grow"><div class="t">${esc(s.name)}</div><div class="s">${esc(sc ? sc.name : '')}</div></div><span class="pill hol">Student</span><span class="chev">${icon('right')}</span></button>`; }));
    return `<div class="list">${rows.join('')}</div>`;
  }
  const schools = sortedSchools();
  if (!schools.length) return `<div class="empty"><img src="logo.png" alt=""><div><b>No schools yet</b></div><div class="hint">Tap “Add school” to create your first training place.</div></div>`;
  return `<div class="list">${schools.map(sc => {
    const n = data.students.filter(s => s.schoolId === sc.id).length;
    const last = sessionsOfSchool(sc.id).filter(s => !s.holiday).pop();
    return `<button class="item" data-act="openSchool" data-id="${sc.id}">
      <div class="grow"><div class="t">${esc(sc.name)}${isDev(sc) ? ' <span class="pill gold">Development</span>' : ''}</div>
      <div class="s">${n} student${n === 1 ? '' : 's'}${last ? ' · last class ' + fmtDateShort(last.date) : ''}</div></div>
      <span class="chev">${icon('right')}</span></button>`;
  }).join('')}</div>`;
}
function viewSchools() {
  const s = data.settings;
  const stale = data.sessions.length && Date.now() - Math.max(s.lastBackup || 0, s.lastSync || 0) > 14 * 86400000;
  return `${topbar('Modern Taekwondo', 'Attendance')}
  ${stale ? `<div class="banner">Last backup: <b>${ago(Math.max(s.lastBackup || 0, s.lastSync || 0))}</b>. Your data lives on this phone, so please <a href="#" data-act="backup">back up now</a>.</div>` : ''}
  <div class="stack">
    <div class="searchbox">${icon('search')}<input type="search" placeholder="Search student or school name…" value="${esc(ui.q)}" data-bind="q" data-live="schoolsList" autocomplete="off"></div>
    <div id="schoolsList">${schoolsListHTML()}</div>
    <button class="btn primary block" data-act="addSchool">${icon('plus')} Add school</button>
  </div>`;
}

/* ---- One school ---- */
function studentListHTML(sc) {
  const q = norm(ui.sq);
  let studs = sortedStudents(sc.id);
  const total = studs.length;
  if (q) studs = studs.filter(s => norm(s.name).includes(q));
  if (!studs.length) return `<div class="empty">${total ? 'No student found.' : 'No students yet. Tap “Add students”.'}</div>`;
  const all = sessionsOfSchool(sc.id), links = classLinks();
  return `<div class="list">${studs.map((s, i) => {
    const st = studentStats(s, all);
    return `<button class="item" data-act="openStudent" data-id="${s.id}">
      <div class="grow"><div class="t">${esc(s.name)}${isBoth(s, links) ? ' <span class="pill gold">Basic + Dev</span>' : ''}</div></div>
      <span class="pill ${st.pct == null ? '' : st.pct >= 75 ? 'ok' : st.pct < 40 ? 'bad' : 'gold'}">${st.tot ? st.att + '/' + st.tot : '–'}</span></button>`;
  }).join('')}</div>`;
}
function viewSchool() {
  const sc = getSchool(ui.schoolId);
  if (!sc) { ui.schoolId = null; return viewSchools(); }
  const seg = `<div class="seg">${[['students', 'Students'], ['attendance', 'Attendance'], ['reports', 'Reports']]
    .map(([k, l]) => `<button class="${ui.sub === k ? 'on' : ''}" data-act="sub" data-sub="${k}">${l}</button>`).join('')}</div>`;
  let body = '';
  if (ui.sub === 'students') {
    const n = data.students.filter(s => s.schoolId === sc.id).length;
    body = `<div class="stack">
      <div class="searchbox">${icon('search')}<input type="search" placeholder="Search student (${n})…" value="${esc(ui.sq)}" data-bind="sq" data-live="studentList" autocomplete="off"></div>
      <div id="studentList">${studentListHTML(sc)}</div>
      <button class="btn primary block" data-act="addStudents">${icon('plus')} Add students</button></div>`;
  } else if (ui.sub === 'attendance') body = viewCalendar(sc);
  else body = viewReports(sc);
  return `<div class="topbar">
      <button class="iconbtn" data-act="backToSchools" aria-label="Back">${icon('left')}</button>
      <div class="grow"><h1>${esc(sc.name)}</h1><div class="sub">${isDev(sc) ? 'Development class' : 'Training place'}</div></div>
      <button class="iconbtn" data-act="editSchool" aria-label="Edit school">${icon('edit')}</button>
    </div>${seg}${body}`;
}

/* ---- Calendar ---- */
function viewCalendar(sc) {
  const { y, m } = ui.cal, ws = 0;
  const first = dowOf(`${y}-${pad(m)}-01`), lead = (first - ws + 7) % 7, dim = daysInMonth(y, m);
  const today = nowKL().date, prefix = `${y}-${pad(m)}-`;
  const by = {};
  sessionsOfSchool(sc.id).forEach(s => { if (s.date.startsWith(prefix)) (by[s.date] = by[s.date] || []).push(s); });
  let cells = '';
  for (let i = 0; i < 7; i++) cells += `<div class="dow">${DOWS[(ws + i) % 7]}</div>`;
  for (let i = 0; i < lead; i++) cells += `<div class="day blank"></div>`;
  for (let d = 1; d <= dim; d++) {
    const ds = prefix + pad(d), list = by[ds] || [];
    const dots = (list.some(s => !s.holiday) ? '<b class="dot-ok"></b>' : '') + (list.some(s => s.holiday) ? '<b class="dot-hol"></b>' : '');
    cells += `<button class="day ${ds === today ? 'today' : ''} ${ds === ui.selDate ? 'sel' : ''}" data-act="selDate" data-date="${ds}"><span>${d}</span><i class="dots">${dots}</i></button>`;
  }
  let panel = `<div class="card hint">Tap a date to see or take attendance.</div>`;
  if (ui.selDate && ui.selDate.startsWith(prefix)) {
    const list = (by[ui.selDate] || []).sort(cmpSession);
    const rows = list.map(s => {
      if (s.holiday) return `<div class="item"><div class="grow"><div class="t">Holiday</div><div class="s">${esc(s.label || 'No class')}</div></div>
        <button class="btn small" data-act="holidayModal" data-date="${s.date}" data-id="${s.id}">Edit</button></div>`;
      const c = countMarks(s);
      return `<button class="item" data-act="editSession" data-id="${s.id}">
        <div class="grow"><div class="t">${fmtTime(s.time)} <span class="pill ok">✓ ${c.p}</span> <span class="pill bad">✗ ${c.a}</span></div>
        ${s.note ? `<div class="s">${esc(s.note.length > 80 ? s.note.slice(0, 80) + '…' : s.note)}</div>` : ''}</div>
        <span class="chev">${icon('edit')}</span></button>`;
    }).join('');
    panel = `<div class="card stack"><div class="row"><div class="grow"><b>${fmtDateLong(ui.selDate)}</b></div>${ui.selDate === today ? '<span class="pill gold">Today</span>' : ''}</div>
      ${rows ? `<div class="list">${rows}</div>` : '<div class="hint">No class recorded for this date.</div>'}
      <div class="row wrap"><button class="btn primary grow" data-act="take" data-date="${ui.selDate}">${icon('plus')} Take attendance</button>
      <button class="btn grow" data-act="holidayModal" data-date="${ui.selDate}">Mark holiday</button></div></div>`;
  }
  return `<div class="stack">
    <div class="calhead">
      <button class="iconbtn" data-act="calPrev" aria-label="Previous month">${icon('left')}</button>
      <select data-bind="cal.m" data-num="1" data-rerender="1" aria-label="Month">${monthOpts(m)}</select>
      <select data-bind="cal.y" data-num="1" data-rerender="1" aria-label="Year" style="max-width:110px">${opts(yearList(), y)}</select>
      <button class="iconbtn" data-act="calNext" aria-label="Next month">${icon('right')}</button>
    </div>
    <div class="cal">${cells}</div>
    <div class="row hint"><span class="pill ok">● class</span><span class="pill hol">● holiday</span><span class="grow"></span><button class="btn small" data-act="calToday">Today</button></div>
    ${panel}</div>`;
}

/* ---- Take attendance ---- */
function viewTake() {
  const t = ui.take, sc = getSchool(t.schoolId), studs = sortedStudents(t.schoolId);
  let p = 0, a = 0, u = 0;
  studs.forEach(s => { const v = t.marks[s.id]; if (v === true) p++; else if (v === false) a++; else u++; });
  const rows = studs.map(s => {
    const v = t.marks[s.id];
    return `<div class="srow"><div class="nm">${esc(s.name)}</div>
      <button class="mk yes ${v === true ? 'on' : ''}" data-act="mark" data-id="${s.id}" data-v="1" aria-label="Present">${icon('check')}</button>
      <button class="mk no ${v === false ? 'on' : ''}" data-act="mark" data-id="${s.id}" data-v="0" aria-label="Absent">${icon('x')}</button></div>`;
  }).join('');
  return `${topbar(sc ? sc.name : 'Attendance', t.id ? 'Edit attendance' : 'Take attendance', 'cancelTake')}
  <div class="stack">
    <div class="card stack">
      <div class="row"><div class="grow"><label class="f">Date</label><input type="date" value="${t.date}" data-bind="take.date"></div>
      <div class="grow"><label class="f">Time (Malaysia)</label><input type="time" value="${t.time}" data-bind="take.time"></div></div>
      <div><label class="f">Description</label><textarea data-bind="take.note">${esc(t.note)}</textarea></div>
    </div>
    <div class="takebar"><div class="counts">
      <div class="c ok">${p}<small>Present</small></div><div class="c bad">${a}<small>Absent</small></div><div class="c">${u}<small>Not marked</small></div></div>
      <div class="row" style="margin-top:8px"><button class="btn small grow" data-act="markAll" data-v="1">All present</button>
      <button class="btn small grow" data-act="markAll" data-v="0">All absent</button><button class="btn small grow" data-act="markAll" data-v="">Clear</button></div></div>
    ${studs.length ? `<div class="list">${rows}</div>` : `<div class="empty">This school has no students yet.<br>Go back and add students first.</div>`}
  </div>
  <div class="savebar"><div class="in">${t.id ? `<button class="btn danger" data-act="delSession">Delete</button>` : ''}
    <button class="btn primary" data-act="saveTake">Save attendance</button></div></div>`;
}

/* ---- Reports (one school) ---- */
function viewReports(sc) {
  const sess = sessionsFor(sc.id, ui.period), classes = sess.filter(s => !s.holiday), hol = sess.filter(s => s.holiday);
  const rows = sortedStudents(sc.id).map(st => Object.assign({ st }, studentStats(st, sess)));
  const came = rows.filter(r => r.att > 0), none = rows.filter(r => r.att === 0 && r.tot > 0), norec = rows.filter(r => r.tot === 0);
  const sumA = rows.reduce((n, r) => n + r.att, 0), sumT = rows.reduce((n, r) => n + r.tot, 0);
  const avg = sumT ? Math.round(sumA * 100 / sumT) + '%' : '–';
  const item = (r, bad) => `<button class="item" data-act="openStudent" data-id="${r.st.id}">
    <div class="grow"><div class="t">${esc(r.st.name)}</div>${r.tot ? `<div class="bar"><i style="width:${r.pct}%"></i></div>` : ''}</div>
    <div style="text-align:right"><b>${r.att}/${r.tot}</b><div class="s">${r.pct == null ? '' : r.pct + '%'}</div></div></button>`;
  const section = (title, list, cls, emptyMsg) => `<div><div class="row" style="margin-bottom:8px"><div class="section-title grow" style="margin:0">${title}</div><span class="pill ${cls}">${list.length}</span></div>
    ${list.length ? `<div class="list">${list.map(r => item(r)).join('')}</div>` : `<div class="hint">${emptyMsg}</div>`}</div>`;
  return `<div class="stack">${periodControls('period')}
    <div class="tiles"><div class="tile"><b>${classes.length}</b><span>Classes</span></div><div class="tile"><b>${hol.length}</b><span>Holidays</span></div><div class="tile"><b>${avg}</b><span>Avg attendance</span></div></div>
    ${section('Came at least once', came, 'ok', 'Nobody has attended in this period.')}
    ${section('Did not come at all', none, 'bad', 'Everyone came at least once.')}
    ${norec.length ? section('No class recorded for them', norec, '', '') : ''}
    <div class="hint">Showing: ${periodLabel(ui.period)}. Holidays are not counted. Tap a student to see the history.</div></div>`;
}

/* ---- Overview (all schools) ---- */
function viewOverview() {
  const schools = sortedSchools();
  let tc = 0, th = 0, ta = 0, tt = 0;
  const rows = schools.map(sc => {
    const sess = sessionsFor(sc.id, ui.period), classes = sess.filter(s => !s.holiday).length, hol = sess.filter(s => s.holiday).length;
    let att = 0, tot = 0, none = 0;
    const studs = sortedStudents(sc.id);
    studs.forEach(st => { const x = studentStats(st, sess); att += x.att; tot += x.tot; if (x.tot > 0 && x.att === 0) none++; });
    tc += classes; th += hol; ta += att; tt += tot;
    return `<button class="item" data-act="openSchool" data-id="${sc.id}" data-sub="reports">
      <div class="grow"><div class="t">${esc(sc.name)}</div><div class="s">${studs.length} students · ${classes} classes · ${hol} holiday${hol === 1 ? '' : 's'}</div>
      ${tot ? `<div class="bar"><i style="width:${Math.round(att * 100 / tot)}%"></i></div>` : ''}</div>
      <div style="text-align:right"><b>${tot ? Math.round(att * 100 / tot) + '%' : '–'}</b>${none ? `<div class="s" style="color:var(--bad)">${none} absent all period</div>` : ''}</div></button>`;
  }).join('');
  return `${topbar('Overview', 'All schools')}<div class="stack">${periodControls('period')}
    <div class="tiles"><div class="tile"><b>${schools.length}</b><span>Schools</span></div><div class="tile"><b>${data.students.length}</b><span>Students</span></div>
    <div class="tile"><b>${tt ? Math.round(ta * 100 / tt) + '%' : '–'}</b><span>Avg attendance</span></div></div>
    ${schools.length ? `<div class="list">${rows}</div>` : '<div class="empty">No schools yet.</div>'}
    <div class="hint">Showing: ${periodLabel(ui.period)}. Tap a school for its report.</div></div>`;
}

/* ---- Settings ---- */
function coachesCardHTML() {
  const coaches = sortedCoaches(), me = data.settings.coachId;
  return `<div class="card stack"><h2>Coaches</h2>
    <div><label class="f">I am (saved with each attendance)</label><select data-bind="settings.coachId" data-save="1" data-rerender="1">${opts([['', 'Choose…'], ...coaches.map(c => [c.id, c.name])], me)}</select></div>
    ${coaches.length ? `<div class="list">${coaches.map(c => { const t = data.syncLog[c.id];
      return `<button class="item" data-act="coachModal" data-id="${c.id}"><div class="grow"><div class="t">${esc(c.name)}${c.id === me ? ' <span class="pill gold">You</span>' : ''}</div>
        <div class="s">${t ? 'Last sync: ' + agoLong(t) + ' · ' + fmtStamp(t) : 'Never synced'}</div></div><span class="chev">${icon('edit')}</span></button>`; }).join('')}</div>` : '<div class="hint">No coaches yet. Add yourself and the other coach.</div>'}
    <button class="btn block" data-act="coachModal">${icon('plus')} Add coach</button>
  </div>`;
}
function viewSettings() {
  const s = data.settings, e = ui.exp;
  const schools = sortedSchools();
  const studs = e.schoolId !== 'all' && e.schoolId !== '__combo' ? sortedStudents(e.schoolId) : [];
  const sheetsOn = !!s.sheetsUrl;
  return `${topbar('Settings', 'Export · Backup · Sync')}
  <div class="stack">
    ${coachesCardHTML()}

    <div class="card stack"><h2>Export to Excel / CSV</h2>
      <div><label class="f">School</label><select data-bind="exp.schoolId" data-rerender="1">${opts([['all', 'All schools (mixed together)'], ['__combo', 'Basic + Development students (combined)'], ...schools.map(x => [x.id, x.name])], e.schoolId)}</select></div>
      ${e.schoolId !== 'all' && e.schoolId !== '__combo' ? `<div><label class="f">Student</label><select data-bind="exp.studentId">${opts([['all', 'All students'], ...studs.map(x => [x.id, x.name])], e.studentId)}</select></div>` : ''}
      <div><label class="f">Period</label>${periodControls('exp.period')}</div>
      <div class="row"><button class="btn primary grow" data-act="exportXlsx">Download Excel</button><button class="btn grow" data-act="exportCsv">Download CSV</button></div>
      <div class="hint">Excel has several sheets: Summary, All Schools (one block per school), a sheet per school, Records and Sessions (with descriptions). “Basic + Development” shows students who are in both a basic and a development school, side by side. CSV is the Records list.</div>
    </div>

    <div class="card stack"><h2>Google Sheets sync</h2>
      <div class="hint">Sync downloads the other coach’s attendance, merges it with yours, then uploads everything to your Google Sheet. ${sheetsOn ? '' : '<b>Not set up yet.</b> Fill in the two boxes below first.'}</div>
      <div><label class="f">Web App URL</label><input type="url" value="${esc(s.sheetsUrl)}" data-bind="settings.sheetsUrl" data-save="1" placeholder="https://script.google.com/macros/s/…/exec"></div>
      <div><label class="f">Secret key (same as in the script)</label><input type="text" value="${esc(s.sheetsKey)}" data-bind="settings.sheetsKey" data-save="1" placeholder="your-secret-word"></div>
      <div class="row"><button class="btn primary grow" data-act="syncNow" ${sheetsOn ? '' : 'disabled'}>Sync now</button><button class="btn grow" data-act="testSync" ${sheetsOn ? '' : 'disabled'}>Test</button></div>
      <button class="btn small" data-act="sheetsHelp">How to set this up</button>
    </div>

    <div class="card stack"><h2>Backup &amp; restore</h2>
      <div class="hint">Last backup: <b>${ago(s.lastBackup)}</b>. The app keeps data on this phone, so back up regularly.</div>
      <div class="row"><button class="btn primary grow" data-act="backup">Backup now</button><button class="btn grow" data-act="restorePick">Restore…</button></div>
      <input type="file" id="restoreFile" accept=".json,application/json" hidden>
    </div>

    <div class="card stack"><h2>App</h2>
      ${ui.installEvt ? `<button class="btn primary block" data-act="installApp">Install app on this phone</button>` : `<div class="hint">To install: in Chrome tap the ⋮ menu → <b>Install app</b> (or <b>Add to Home screen</b>).</div>`}
      <div class="hint" id="storageInfo"></div>
      <button class="btn danger block" data-act="eraseAll">Erase all data on this phone</button>
    </div>
    <div class="foot"><img src="logo.png" alt="Modern Taekwondo"><div class="ver"><b>Version ${APP_VERSION}</b>Modern Taekwondo Attendance</div></div>
  </div>`;
}

/* ============ back button support ============ */
let applyingPop = false;
const navState = () => ({ t: ui.tab, s: ui.schoolId, u: ui.sub, k: !!ui.take });
function syncHistory() {
  if (applyingPop) return;
  const cur = history.state, now = navState();
  if (!cur) { history.replaceState(now, ''); return; }
  if (cur.t === now.t && cur.s === now.s && cur.k === now.k) { if (cur.u !== now.u) history.replaceState(now, ''); return; }
  history.pushState(now, '');
}
function leaveTake() { if (history.state && history.state.k) history.back(); else render(false); }

/* ============ render ============ */
function render(keepScroll = true) {
  const y = window.scrollY;
  const app = $('#app');
  let html;
  if (ui.take) html = viewTake();
  else if (ui.tab === 'schools') html = ui.schoolId ? viewSchool() : viewSchools();
  else if (ui.tab === 'overview') html = viewOverview();
  else html = viewSettings();
  app.className = ui.take ? 'no-nav' : '';
  app.innerHTML = html + (ui.take ? '' : navHTML());
  window.scrollTo(0, keepScroll ? y : 0);
  syncHistory();
  if (ui.tab === 'settings' && !ui.take) storageInfo();
}
async function storageInfo() {
  const el = $('#storageInfo'); if (!el || !navigator.storage) return;
  try {
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    el.textContent = persisted ? 'Storage protected: this phone will not clear the app data automatically.' : 'Tip: install the app to the home screen so the phone keeps the data safely.';
  } catch (e) { /* ignore */ }
}
const go = fn => { fn(); render(false); };

/* ============ modals ============ */
function showModal(html) {
  $('#modal-root').innerHTML = `<div class="overlay" data-act="overlay"><div class="modal" role="dialog">${html}</div></div>`;
  document.body.classList.add('noscroll');
  const f = $('#modal-root input[type=text],#modal-root textarea'); if (f) setTimeout(() => f.focus(), 60);
}
function closeModal() { $('#modal-root').innerHTML = ''; document.body.classList.remove('noscroll'); }
const mval = id => ($('#' + id) ? $('#' + id).value : '');

function modalAddSchool() {
  showModal(`<h3>Add school</h3><label class="f">School / training place name</label>
    <input type="text" id="m-name" data-enter="1" placeholder="e.g. SJK(C) Seremban" autocomplete="off">
    <label class="f" style="margin-top:12px">Class type</label><select id="m-type"><option value="basic">Basic class (Mon–Fri)</option><option value="dev">Development class (Saturday)</option></select>
    <div class="actions"><button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" data-act="saveAddSchool">Add</button></div>`);
}
function modalEditSchool() {
  const sc = getSchool(ui.schoolId);
  showModal(`<h3>Edit school</h3><label class="f">Name</label><input type="text" id="m-name" data-enter="1" value="${esc(sc.name)}">
    <label class="f" style="margin-top:12px">Class type</label><select id="m-type"><option value="basic" ${isDev(sc) ? '' : 'selected'}>Basic class (Mon–Fri)</option><option value="dev" ${isDev(sc) ? 'selected' : ''}>Development class (Saturday)</option></select>
    <div class="actions"><button class="btn danger" data-act="delSchool">Delete</button><button class="btn primary" data-act="saveSchool">Save</button></div>
    <div class="actions" style="margin-top:8px"><button class="btn" data-act="closeModal">Close</button></div>`);
}
function modalAddStudents() {
  showModal(`<h3>Add students</h3><label class="f">One name per line. You can paste a whole list.</label>
    <textarea id="m-names" style="min-height:160px" placeholder="Ali bin Ahmad&#10;Tan Mei Ling&#10;Kumar a/l Raj"></textarea>
    <button class="btn block" style="margin-top:12px" data-act="copyModal">Copy from another school</button>
    <div class="actions"><button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" data-act="saveStudents">Add</button></div>`);
}
function modalStudent(id) {
  const st = getStudent(id); if (!st) return;
  const sc = getSchool(st.schoolId), all = sessionsOfSchool(st.schoolId), cur = sessionsFor(st.schoolId, ui.period);
  const a = studentStats(st, all), c = studentStats(st, cur);
  const linked = data.students.filter(x => norm(x.name) === norm(st.name));
  let comboRows = '';
  if (linked.length > 1) {
    let ca = 0, ct = 0; linked.forEach(x => { const r = studentStats(x, sessionsOfSchool(x.schoolId)); ca += r.att; ct += r.tot; });
    comboRows = `<div class="kv"><span>All classes combined</span><b>${ca} of ${ct}${ct ? ' (' + Math.round(ca * 100 / ct) + '%)' : ''}</b></div><div class="kv"><span>Also listed in</span><b style="text-align:right">${linked.filter(x => x.id !== st.id).map(x => esc((getSchool(x.schoolId) || {}).name || '')).join(', ')}</b></div>`;
  }
  const hist = all.filter(s => !s.holiday && s.marks && s.marks[st.id] !== undefined).reverse();
  showModal(`<h3>${esc(st.name)}${isBoth(st, classLinks()) ? ' <span class="pill gold">Basic + Dev</span>' : ''}</h3><div class="hint" style="margin:-8px 0 10px">${esc(sc ? sc.name : '')}</div>
    <div class="card" style="padding:8px 12px">
      <div class="kv"><span>All time</span><b>${a.att} of ${a.tot} classes${a.pct == null ? '' : ' (' + a.pct + '%)'}</b></div>
      <div class="kv"><span>${periodLabel(ui.period)}</span><b>${c.att} of ${c.tot}${c.pct == null ? '' : ' (' + c.pct + '%)'}</b></div>${comboRows}</div>
    <div class="section-title" style="margin:14px 0 8px">History</div>
    ${hist.length ? `<div class="hist">${hist.map(s => `<div><span class="d">${fmtDateShort(s.date)} · ${fmtTime(s.time)}${s.note ? ' · ' + esc(s.note.slice(0, 40)) : ''}</span>${s.marks[st.id] ? '<span class="pill ok">✓ Came</span>' : '<span class="pill bad">✗ Absent</span>'}</div>`).join('')}</div>` : '<div class="hint">No attendance yet.</div>'}
    <label class="f" style="margin-top:14px">Rename</label><input type="text" id="m-name" data-enter="1" value="${esc(st.name)}" data-sid="${st.id}">
    <div class="actions"><button class="btn danger" data-act="delStudent" data-id="${st.id}">Delete</button><button class="btn primary" data-act="saveStudentName" data-id="${st.id}">Save name</button></div>
    <div class="actions" style="margin-top:8px"><button class="btn" data-act="closeModal">Close</button></div>`);
}
function modalHoliday(date, id) {
  const s = id && getSession(id);
  showModal(`<h3>${s ? 'Edit holiday' : 'Mark as holiday'}</h3><div class="hint" style="margin:-6px 0 12px">${fmtDateLong(date)}. No class, so it is not counted.</div>
    <label class="f">Reason</label><input type="text" id="m-label" data-enter="1" value="${esc(s ? s.label : 'Public holiday')}" list="holidayReasons">
    <datalist id="holidayReasons"><option value="Public holiday"><option value="School holiday"><option value="Exam week"><option value="No class"></datalist>
    ${s ? '' : `<label class="row" style="margin-top:14px;gap:10px"><input type="checkbox" id="m-all" style="width:22px;height:22px"> <span>Apply to all schools</span></label>`}
    <div class="actions">${s ? `<button class="btn danger" data-act="delHoliday" data-id="${s.id}">Remove</button>` : `<button class="btn" data-act="closeModal">Cancel</button>`}
    <button class="btn primary" data-act="saveHoliday" data-date="${date}" data-id="${s ? s.id : ''}">Save</button></div>`);
}
function modalSheetsHelp() {
  showModal(`<h3>Google Sheets setup</h3><ol class="steps">
    <li>Create a new Google Sheet (any name, e.g. “MT Attendance”).</li>
    <li>In the sheet: <b>Extensions → Apps Script</b>.</li>
    <li>Delete the sample code and paste everything from the file <code>Code.gs</code>. Change <code>SECRET</code> at the top to your own secret word. Save.</li>
    <li>Click <b>Deploy → New deployment</b>, type <b>Web app</b>. Execute as: <b>Me</b>. Who has access: <b>Anyone</b>. Deploy, and allow the permissions.</li>
    <li>Copy the <b>Web app URL</b>. Paste it here in Settings, with the same secret word.</li>
    <li>Tap <b>Test</b>, then <b>Sync now</b>.</li></ol>
    <div class="hint">Both coaches use the same URL and secret. Each time you tap Sync, the app first downloads the other coach’s changes, merges them, then uploads everything and refreshes the readable sheets.</div>
    <div class="actions"><button class="btn primary" data-act="closeModal">Close</button></div>`);
}

function modalCopy(srcId) {
  const others = sortedSchools().filter(s => s.id !== ui.schoolId);
  if (!others.length) return toast('There is no other school yet.');
  if (!others.some(s => s.id === srcId)) srcId = others[0].id;
  const have = new Set(sortedStudents(ui.schoolId).map(s => norm(s.name)));
  const list = sortedStudents(srcId);
  showModal(`<h3>Copy students</h3><div class="hint" style="margin:-6px 0 10px">Tick the students to add to this school. Names are copied exactly, so basic and development records stay linked.</div>
    <label class="f">From school</label><select id="m-src">${opts(others.map(s => [s.id, s.name]), srcId)}</select>
    <div class="stack" style="margin-top:12px">${list.length ? list.map(st => { const dup = have.has(norm(st.name));
      return `<label class="pick ${dup ? 'dis' : ''}"><input type="checkbox" class="cp" value="${st.id}" ${dup ? 'disabled' : ''}><span>${esc(st.name)}${dup ? ' <span class="hint">(already here)</span>' : ''}</span></label>`; }).join('') : '<div class="hint">That school has no students.</div>'}</div>
    <div class="actions"><button class="btn" data-act="copyAll">Select all</button><button class="btn primary" data-act="saveCopy">Add selected</button></div>
    <div class="actions" style="margin-top:8px"><button class="btn" data-act="closeModal">Cancel</button></div>`);
}
function modalCoach(id) {
  const c = id && getCoach(id);
  showModal(`<h3>${c ? 'Edit coach' : 'Add coach'}</h3><label class="f">Coach name</label>
    <input type="text" id="m-name" data-enter="1" value="${esc(c ? c.name : '')}" autocomplete="off">
    <div class="actions">${c ? `<button class="btn danger" data-act="delCoach" data-id="${c.id}">Remove</button>` : `<button class="btn" data-act="closeModal">Cancel</button>`}
    <button class="btn primary" data-act="saveCoach" data-id="${c ? c.id : ''}">Save</button></div>
    ${c ? '<div class="actions" style="margin-top:8px"><button class="btn" data-act="closeModal">Close</button></div>' : ''}`);
}

/* ============ export ============ */
const autoWidth = rows => {
  const w = [];
  rows.forEach(r => r.forEach((v, i) => { const l = String(v ?? '').split('\n').reduce((m, x) => Math.max(m, x.length), 0); w[i] = Math.min(40, Math.max(w[i] || 8, l + 2)); }));
  return w.map(x => ({ wch: x }));
};
function matrixRows(sc, studs, sess) {
  const rows = [[sc.name]];
  const head = ['Student', ...sess.map(s => fmtDateShort(s.date)), 'Attended', 'Classes', '%'];
  rows.push(head);
  rows.push(['Time', ...sess.map(s => s.holiday ? 'HOLIDAY' : fmtTime(s.time)), '', '', '']);
  for (const st of studs) {
    const x = studentStats(st, sess);
    rows.push([st.name, ...sess.map(s => s.holiday ? '–' : s.marks[st.id] === true ? '✓' : s.marks[st.id] === false ? '✗' : ''), x.att, x.tot, x.pct == null ? '' : x.pct]);
  }
  rows.push(['Description', ...sess.map(s => s.holiday ? (s.label || '') : (s.note || '')), '', '', '']);
  rows.push(['Coach', ...sess.map(s => s.holiday ? '' : (s.coach || '')), '', '', '']);
  return rows;
}
function buildSheets(opt) {
  const schoolId = opt.schoolId || 'all', studentId = opt.studentId || 'all', period = opt.period || { type: 'all' };
  const schools = sortedSchools().filter(s => schoolId === 'all' || s.id === schoolId);
  const sum = [['School', 'Student', 'Classes attended', 'Classes recorded', 'Absent', 'Attendance %']];
  const rec = [['School', 'Student', 'Date', 'Day', 'Time', 'Status', 'Description', 'Coach', 'Class type']];
  const ses = [['School', 'Date', 'Day', 'Time', 'Type', 'Holiday reason', 'Present', 'Absent', 'Description', 'Coach', 'Class type']];
  const all = [], per = [];
  for (const sc of schools) {
    let studs = sortedStudents(sc.id); if (studentId !== 'all') studs = studs.filter(s => s.id === studentId);
    const sess = sessionsFor(sc.id, period);
    const block = matrixRows(sc, studs, sess);
    all.push(...block, []); per.push({ name: sc.name, rows: block });
    for (const st of studs) {
      const x = studentStats(st, sess);
      sum.push([sc.name, st.name, x.att, x.tot, x.tot - x.att, x.pct == null ? '' : x.pct]);
      for (const s of sess) {
        if (s.holiday || s.marks[st.id] === undefined) continue;
        rec.push([sc.name, st.name, s.date, DOWS[dowOf(s.date)], fmtTime(s.time), s.marks[st.id] ? 'Present' : 'Absent', s.note || '', s.coach || '', isDev(sc) ? 'Development' : 'Basic']);
      }
    }
    for (const s of sess) {
      let p = 0, a = 0; studs.forEach(st => { if (s.marks[st.id] === true) p++; else if (s.marks[st.id] === false) a++; });
      ses.push([sc.name, s.date, DOWS[dowOf(s.date)], s.holiday ? '' : fmtTime(s.time), s.holiday ? 'Holiday' : 'Class', s.holiday ? (s.label || '') : '', s.holiday ? '' : p, s.holiday ? '' : a, s.holiday ? '' : (s.note || ''), s.holiday ? '' : (s.coach || ''), isDev(sc) ? 'Development' : 'Basic']);
    }
  }
  const used = new Set(['summary', 'all schools', 'records', 'sessions']);
  const sheets = [{ name: 'Summary', rows: sum }, { name: 'All Schools', rows: all.length ? all : [['No data']] }];
  if (schools.length > 1) per.forEach(p => {
    let base = p.name.replace(/[\\\/\?\*\[\]:]/g, ' ').trim().slice(0, 28) || 'School', nm = base, i = 2;
    while (used.has(nm.toLowerCase())) nm = base.slice(0, 27) + ' ' + i++;
    used.add(nm.toLowerCase()); sheets.push({ name: nm, rows: p.rows });
  });
  sheets.push({ name: 'Records', rows: rec }, { name: 'Sessions', rows: ses });
  return sheets;
}
function comboGroups() {
  const g = new Map();
  data.students.forEach(st => {
    const sc = getSchool(st.schoolId); if (!sc) return;
    const k = norm(st.name), e = g.get(k) || { name: st.name, entries: [], b: false, d: false };
    e.entries.push(st); if (isDev(sc)) e.d = true; else e.b = true; g.set(k, e);
  });
  return [...g.values()].filter(e => e.b && e.d).sort((a, b) => collator.compare(a.name, b.name));
}
function buildCombinedSheets(period) {
  const groups = comboGroups();
  if (!groups.length) return [
    { name: 'Basic + Development', rows: [['No student is listed in both a Basic school and a Development school yet.'], ['Tip: use “Copy from another school” when adding students to the Development class, so the names match.']] },
    { name: 'Combined Summary', rows: [['No data']] }, { name: 'Records', rows: [['No data']] }];
  const schoolIds = new Set(); groups.forEach(g => g.entries.forEach(s => schoolIds.add(s.schoolId)));
  const cols = data.sessions.filter(s => schoolIds.has(s.schoolId) && !s.holiday && inPeriod(s.date, period) &&
    groups.some(g => g.entries.some(st => st.schoolId === s.schoolId && s.marks[st.id] !== undefined))).sort(cmpSession);
  const tails = ['Basic attended', 'Basic classes', 'Dev attended', 'Dev classes', 'Total attended', 'Total classes', '%'];
  const blank = tails.map(() => '');
  const matrix = [['Basic + Development'],
    ['Student', ...cols.map(s => fmtDateShort(s.date)), ...tails],
    ['Time', ...cols.map(s => fmtTime(s.time)), ...blank],
    ['Class', ...cols.map(s => isDev(getSchool(s.schoolId)) ? 'Development' : 'Basic'), ...blank],
    ['School', ...cols.map(s => getSchool(s.schoolId).name), ...blank]];
  const summary = [['Student', 'Basic school(s)', 'Development school(s)', ...tails]];
  const rec = [['Student', 'School', 'Class type', 'Date', 'Day', 'Time', 'Status', 'Description', 'Coach']];
  for (const g of groups) {
    let ba = 0, bt = 0, da = 0, dt = 0;
    g.entries.forEach(st => { const x = studentStats(st, sessionsFor(st.schoolId, period)); if (isDev(getSchool(st.schoolId))) { da += x.att; dt += x.tot; } else { ba += x.att; bt += x.tot; } });
    const ta = ba + da, tt = bt + dt, pct = tt ? Math.round(ta * 100 / tt) : '';
    matrix.push([g.name, ...cols.map(s => { const en = g.entries.find(st => st.schoolId === s.schoolId); const v = en ? s.marks[en.id] : undefined; return v === true ? '✓' : v === false ? '✗' : ''; }), ba, bt, da, dt, ta, tt, pct]);
    const names = d => g.entries.filter(st => isDev(getSchool(st.schoolId)) === d).map(st => getSchool(st.schoolId).name).join(', ');
    summary.push([g.name, names(false), names(true), ba, bt, da, dt, ta, tt, pct]);
    g.entries.forEach(st => { const sc = getSchool(st.schoolId);
      sessionsFor(st.schoolId, period).forEach(s => { if (s.holiday || s.marks[st.id] === undefined) return;
        rec.push([g.name, sc.name, isDev(sc) ? 'Development' : 'Basic', s.date, DOWS[dowOf(s.date)], fmtTime(s.time), s.marks[st.id] ? 'Present' : 'Absent', s.note || '', s.coach || '']); }); });
  }
  return [{ name: 'Basic + Development', rows: matrix }, { name: 'Combined Summary', rows: summary }, { name: 'Records', rows: rec }];
}
function getExportSheets() {
  const e = ui.exp;
  return e.schoolId === '__combo' ? buildCombinedSheets(e.period) : buildSheets({ schoolId: e.schoolId, studentId: e.studentId, period: e.period });
}
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}
function exportName(ext) {
  const e = ui.exp, sc = e.schoolId === 'all' ? 'All-Schools' : e.schoolId === '__combo' ? 'Basic-and-Development' : (getSchool(e.schoolId) || { name: 'School' }).name;
  return `Modern-Taekwondo_${sc}_${periodLabel(e.period)}`.replace(/[^\w\-]+/g, '-').replace(/-+/g, '-') + '.' + ext;
}
function exportXlsx() {
  if (!data.schools.length) return toast('Nothing to export yet.');
  if (typeof XLSX === 'undefined') return toast('Excel library missing. Check xlsx.mini.min.js.');
  const sheets = getExportSheets();
  const wb = XLSX.utils.book_new();
  sheets.forEach(s => { const ws = XLSX.utils.aoa_to_sheet(s.rows); ws['!cols'] = autoWidth(s.rows); XLSX.utils.book_append_sheet(wb, ws, s.name); });
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  download(exportName('xlsx'), new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  toast('Excel file saved to Downloads');
}
function exportCsv() {
  if (!data.schools.length) return toast('Nothing to export yet.');
  const rows = getExportSheets().find(s => s.name === 'Records').rows;
  const q = v => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n');
  download(exportName('csv'), new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  toast('CSV file saved to Downloads');
}

/* ============ backup / restore ============ */
function backupNow() {
  const stamp = nowKL().date.replace(/-/g, '');
  const blob = new Blob([JSON.stringify({ app: 'mt-attendance', v: 1, exportedAt: new Date().toISOString(), data: dataForShare(), settings: data.settings }, null, 1)], { type: 'application/json' });
  download(`MT-Attendance-backup-${stamp}.json`, blob);
  data.settings.lastBackup = Date.now(); save(); toast('Backup saved to Downloads'); render();
}
function restoreFromFile(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const obj = JSON.parse(r.result); const d = normalize(obj.data || obj);
      if (!obj.data && !Array.isArray(obj.schools)) throw new Error('bad');
      ui.pendingRestore = { d, settings: obj.settings };
      showModal(`<h3>Restore backup</h3><div class="card" style="padding:8px 12px">
        <div class="kv"><span>Schools</span><b>${d.schools.length}</b></div><div class="kv"><span>Students</span><b>${d.students.length}</b></div><div class="kv"><span>Attendance records</span><b>${d.sessions.length}</b></div></div>
        <div class="hint" style="margin-top:10px"><b>Merge</b> keeps what is on this phone and adds/updates from the backup (best for two coaches). <b>Replace</b> erases this phone’s data first.</div>
        <div class="actions"><button class="btn primary" data-act="restoreMerge">Merge</button><button class="btn danger" data-act="restoreReplace">Replace</button></div>
        <div class="actions" style="margin-top:8px"><button class="btn" data-act="closeModal">Cancel</button></div>`);
    } catch (e) { toast('That file is not a valid backup.'); }
  };
  r.readAsText(file);
}

/* ============ Google Sheets sync ============ */
async function callScript(method, payload) {
  const { sheetsUrl, sheetsKey } = data.settings;
  if (!sheetsUrl) throw new Error('Add the Web App URL first.');
  let res;
  if (method === 'GET') res = await fetch(sheetsUrl + (sheetsUrl.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(sheetsKey || '') + (payload || ''));
  else res = await fetch(sheetsUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ key: sheetsKey || '' }, payload)) });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'The script returned an error.');
  return j;
}
async function testSync() {
  try { toast('Testing…'); await callScript('GET', '&ping=1'); toast('Connected to Google Sheets ✓'); }
  catch (e) { toast('Could not connect: ' + e.message); }
}
async function syncNow() {
  const me = getCoach(data.settings.coachId);
  if (!me) return toast('Choose “I am” in Coaches first.');
  const prev = data.syncLog[me.id];
  try {
    toast('Syncing…');
    const j = await callScript('GET');
    if (j.data) applyMerged(mergeData(dataForShare(), normalize(j.data)));
    data.syncLog[me.id] = Date.now();
    await flush();
    const sheets = buildSheets({ schoolId: 'all', studentId: 'all', period: { type: 'all' } });
    if (comboGroups().length) sheets.push(...buildCombinedSheets({ type: 'all' }).slice(0, 2));
    await callScript('POST', { data: dataForShare(), sheets });
    data.settings.lastSync = Date.now(); save(); render(); toast('Synced with Google Sheets ✓');
  } catch (e) {
    if (prev === undefined) delete data.syncLog[me.id]; else data.syncLog[me.id] = prev;
    save(); toast('Sync failed: ' + e.message);
  }
}

/* ============ actions ============ */
function openTake(schoolId, sessionId, date) {
  const s = sessionId && getSession(sessionId), n = nowKL();
  ui.take = s ? { id: s.id, schoolId: s.schoolId, date: s.date, time: s.time, note: s.note || '', marks: Object.assign({}, s.marks), dirty: false }
              : { id: null, schoolId, date: date || n.date, time: n.time, note: '', marks: {}, dirty: false };
}
function saveTake() {
  const t = ui.take, studs = sortedStudents(t.schoolId);
  if (!studs.length) return toast('Add students first.');
  if (!t.date || !t.time) return toast('Please set the date and time.');
  const dup = data.sessions.find(s => s.schoolId === t.schoolId && s.date === t.date && s.time === t.time && !s.holiday && s.id !== t.id);
  if (dup && !confirm('There is already attendance for this date and time. Save as another record?')) return;
  const unmarked = studs.filter(s => t.marks[s.id] === undefined);
  if (!t.id && unmarked.length) {
    if (!confirm(`${unmarked.length} student${unmarked.length > 1 ? 's are' : ' is'} not marked. Save as absent?`)) return;
    unmarked.forEach(s => { t.marks[s.id] = false; });
  }
  let s = t.id && getSession(t.id);
  if (!s) { s = { id: uid(), schoolId: t.schoolId, createdAt: Date.now() }; data.sessions.push(s); }
  Object.assign(s, { date: t.date, time: t.time, note: t.note.trim(), holiday: false, label: '', marks: Object.assign({}, t.marks), coach: myCoachName() || s.coach || '' });
  touch(s); save();
  ui.selDate = t.date; ui.cal = { y: +t.date.slice(0, 4), m: +t.date.slice(5, 7) };
  ui.take = null; ui.tab = 'schools'; ui.schoolId = t.schoolId; ui.sub = 'attendance';
  leaveTake(); toast('Attendance saved ✓');
}

const actions = {
  tab(el) { go(() => { ui.tab = el.dataset.tab; if (ui.tab === 'schools') ui.schoolId = null; }); },
  openSchool(el) {
    go(() => { ui.tab = 'schools'; ui.schoolId = el.dataset.id; ui.sub = el.dataset.sub || 'students'; ui.sq = ''; ui.selDate = nowKL().date; ui.cal = { y: +ui.selDate.slice(0, 4), m: +ui.selDate.slice(5, 7) }; });
    if (el.dataset.open) modalStudent(el.dataset.open);
  },
  backToSchools() { if (history.state && history.state.s && history.length > 1) history.back(); else go(() => { ui.schoolId = null; }); },
  sub(el) { go(() => { ui.sub = el.dataset.sub; }); },

  addSchool: modalAddSchool,
  saveAddSchool() {
    const n = mval('m-name').trim(); if (!n) return toast('Please type a name.');
    if (data.schools.some(s => norm(s.name) === norm(n))) return toast('That school already exists.');
    data.schools.push(touch({ id: uid(), name: n, type: mval('m-type') === 'dev' ? 'dev' : 'basic', createdAt: Date.now() })); save(); closeModal(); render(); toast('School added');
  },
  editSchool: modalEditSchool,
  saveSchool() {
    const n = mval('m-name').trim(); if (!n) return toast('Please type a name.');
    const sc = getSchool(ui.schoolId); sc.name = n; sc.type = mval('m-type') === 'dev' ? 'dev' : 'basic'; touch(sc); save(); closeModal(); render();
  },
  delSchool() {
    const sc = getSchool(ui.schoolId);
    if (!confirm(`Delete “${sc.name}” with ALL its students and attendance records? This cannot be undone.`)) return;
    deleteSchool(sc.id); save(); closeModal(); ui.schoolId = null; render(false); toast('School deleted');
  },

  addStudents: modalAddStudents,
  saveStudents() {
    const names = mval('m-names').split(/\r?\n/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!names.length) return toast('Please type at least one name.');
    const have = new Set(sortedStudents(ui.schoolId).map(s => norm(s.name))); let added = 0, skipped = 0;
    for (const n of names) { if (have.has(norm(n))) { skipped++; continue; } have.add(norm(n)); data.students.push(touch({ id: uid(), schoolId: ui.schoolId, name: n, createdAt: Date.now() })); added++; }
    save(); closeModal(); render(); toast(`${added} added${skipped ? ', ' + skipped + ' duplicate skipped' : ''}`);
  },
  openStudent(el) { modalStudent(el.dataset.id); },
  saveStudentName(el) {
    const n = mval('m-name').replace(/\s+/g, ' ').trim(); if (!n) return toast('Please type a name.');
    const st = getStudent(el.dataset.id); st.name = n; touch(st); save(); closeModal(); render();
  },
  delStudent(el) {
    const st = getStudent(el.dataset.id);
    if (!confirm(`Delete ${st.name} and all of their attendance records? This cannot be undone.`)) return;
    deleteStudent(st.id); save(); closeModal(); render(); toast('Student deleted');
  },

  calPrev() { go(() => { ui.cal.m--; if (ui.cal.m < 1) { ui.cal.m = 12; ui.cal.y--; } calSel(); }); },
  calNext() { go(() => { ui.cal.m++; if (ui.cal.m > 12) { ui.cal.m = 1; ui.cal.y++; } calSel(); }); },
  calToday() { go(() => { const n = nowKL().date; ui.cal = { y: +n.slice(0, 4), m: +n.slice(5, 7) }; ui.selDate = n; }); },
  selDate(el) { ui.selDate = el.dataset.date; render(); },

  take(el) { go(() => openTake(ui.schoolId, null, el.dataset.date)); },
  editSession(el) { const s = getSession(el.dataset.id); go(() => openTake(s.schoolId, s.id)); },
  mark(el) {
    const t = ui.take, v = el.dataset.v === '1';
    if (t.marks[el.dataset.id] === v) delete t.marks[el.dataset.id]; else t.marks[el.dataset.id] = v;
    t.dirty = true; render();
  },
  markAll(el) {
    const t = ui.take; t.dirty = true;
    sortedStudents(t.schoolId).forEach(s => { if (el.dataset.v === '') delete t.marks[s.id]; else t.marks[s.id] = el.dataset.v === '1'; });
    render();
  },
  saveTake,
  cancelTake() { if (ui.take.dirty && !confirm('Leave without saving?')) return; ui.take = null; leaveTake(); },
  delSession() {
    if (!confirm('Delete this attendance record? This cannot be undone.')) return;
    deleteSession(ui.take.id); save(); ui.take = null; leaveTake(); toast('Deleted');
  },

  holidayModal(el) { modalHoliday(el.dataset.date, el.dataset.id || ''); },
  saveHoliday(el) {
    const label = mval('m-label').trim() || 'Holiday', all = $('#m-all') && $('#m-all').checked, date = el.dataset.date;
    if (el.dataset.id) { const s = getSession(el.dataset.id); s.label = label; touch(s); }
    else {
      const targets = all ? data.schools.map(s => s.id) : [ui.schoolId];
      targets.forEach(sid => {
        if (data.sessions.some(s => s.schoolId === sid && s.date === date && s.holiday)) return;
        data.sessions.push(touch({ id: uid(), schoolId: sid, date, time: '', note: '', holiday: true, label, marks: {}, coach: myCoachName(), createdAt: Date.now() }));
      });
    }
    save(); closeModal(); render(); toast('Holiday saved');
  },
  delHoliday(el) { deleteSession(el.dataset.id); save(); closeModal(); render(); toast('Holiday removed'); },

  exportXlsx, exportCsv, backup: backupNow,
  restorePick() { const f = $('#restoreFile'); f.value = ''; f.click(); },
  restoreMerge() {
    const p = ui.pendingRestore; applyMerged(mergeData(dataForShare(), p.d));
    save(); closeModal(); render(); toast('Backup merged ✓');
  },
  restoreReplace() {
    const p = ui.pendingRestore;
    if (!confirm('Replace ALL data on this phone with the backup?')) return;
    const keep = Object.assign({}, data.settings);
    data = normalize(p.d); data.settings = Object.assign(keep, {}); ui.schoolId = null;
    save(); closeModal(); render(false); toast('Backup restored ✓');
  },
  syncNow, testSync, sheetsHelp: modalSheetsHelp,
  coachModal(el) { modalCoach(el.dataset.id || ''); },
  saveCoach(el) {
    const n = mval('m-name').replace(/\s+/g, ' ').trim(); if (!n) return toast('Please type a name.');
    if (data.coaches.some(c => c.id !== el.dataset.id && norm(c.name) === norm(n))) return toast('That coach already exists.');
    if (el.dataset.id) { const c = getCoach(el.dataset.id); c.name = n; touch(c); }
    else { const c = touch({ id: uid(), name: n, createdAt: Date.now() }); data.coaches.push(c); if (!data.settings.coachId) data.settings.coachId = c.id; }
    save(); closeModal(); render();
  },
  delCoach(el) {
    const c = getCoach(el.dataset.id); if (!c || !confirm(`Remove coach “${c.name}”? Attendance already taken keeps the name.`)) return;
    data.coaches = data.coaches.filter(x => x.id !== c.id); tomb(c.id); delete data.syncLog[c.id];
    if (data.settings.coachId === c.id) data.settings.coachId = '';
    save(); closeModal(); render();
  },
  copyModal() { modalCopy(); },
  copyAll() { const boxes = [...document.querySelectorAll('#modal-root .cp:not(:disabled)')]; const all = boxes.every(b => b.checked); boxes.forEach(b => { b.checked = !all; }); },
  saveCopy() {
    const ids = [...document.querySelectorAll('#modal-root .cp:checked')].map(b => b.value);
    if (!ids.length) return toast('Tick at least one student.');
    const have = new Set(sortedStudents(ui.schoolId).map(s => norm(s.name))); let n = 0;
    ids.forEach(id => { const src = getStudent(id); if (!src || have.has(norm(src.name))) return; have.add(norm(src.name)); data.students.push(touch({ id: uid(), schoolId: ui.schoolId, name: src.name, createdAt: Date.now() })); n++; });
    save(); closeModal(); render(); toast(`${n} student${n === 1 ? '' : 's'} added`);
  },
  async installApp() { const e = ui.installEvt; if (!e) return; e.prompt(); try { await e.userChoice; } catch (x) { /* ignore */ } ui.installEvt = null; render(); },
  eraseAll() {
    if (!confirm('Erase ALL schools, students and attendance on this phone?')) return;
    if (!confirm('Really erase everything? Make sure you have a backup.')) return;
    const keep = data.settings; data = emptyData(); data.settings = keep; ui.schoolId = null; save(); render(false); toast('All data erased');
  },
  closeModal,
  overlay(el, e) { if (e.target === el) closeModal(); }
};
function calSel() { const n = nowKL().date, pre = `${ui.cal.y}-${pad(ui.cal.m)}-`; ui.selDate = n.startsWith(pre) ? n : null; }

/* ============ events ============ */
const live = { schoolsList: () => schoolsListHTML(), studentList: () => studentListHTML(getSchool(ui.schoolId)) };
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = actions[el.dataset.act]; if (!fn) return;
  if (el.tagName === 'A') e.preventDefault();
  fn(el, e);
});
function setPath(obj, path, val) { const k = path.split('.'); let o = obj; for (let i = 0; i < k.length - 1; i++) o = o[k[i]]; o[k[k.length - 1]] = val; }
function onBind(e) {
  const el = e.target.closest('[data-bind]'); if (!el) return;
  if (e.type === 'change' && !el.dataset.rerender && el.tagName !== 'SELECT' && el.type !== 'date' && el.type !== 'time') return;
  const path = el.dataset.bind; let val = el.value; if (el.dataset.num) val = Number(val);
  if (path.startsWith('settings.')) { setPath(data, path, val); }
  else setPath(ui, path, val);
  if (path.startsWith('take.')) { ui.take.dirty = true; return; }
  if (path === 'exp.schoolId') ui.exp.studentId = 'all';
  if (path.startsWith('cal.')) calSel();
  if (el.dataset.save) save();
  if (el.dataset.live) { const t = $('#' + el.dataset.live); if (t) t.innerHTML = live[el.dataset.live](); return; }
  if (el.dataset.rerender && e.type === 'change') render();
}
document.addEventListener('input', onBind);
document.addEventListener('change', e => {
  if (e.target.id === 'restoreFile' && e.target.files[0]) { restoreFromFile(e.target.files[0]); return; }
  if (e.target.id === 'm-src') { modalCopy(e.target.value); return; }
  onBind(e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('.modal input[data-enter]')) { e.preventDefault(); const b = $('.modal .btn.primary'); if (b) b.click(); }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', flush);
window.addEventListener('popstate', e => {
  if ($('#modal-root').innerHTML) { closeModal(); history.pushState(navState(), ''); return; }   // back closes a popup first
  const st = e.state; if (!st) return;
  if (ui.take && !st.k) {
    if (ui.take.dirty && !confirm('Leave without saving?')) { history.pushState(navState(), ''); return; }
    ui.take = null;
  } else if (!ui.take && st.k) { history.replaceState(navState(), ''); return; }
  ui.tab = st.t; ui.schoolId = st.s; ui.sub = st.u;
  applyingPop = true; render(false); applyingPop = false;
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); ui.installEvt = e; if (ui.tab === 'settings' && !ui.take) render(); });

/* ============ start ============ */
function migrate() {
  if (!data.coaches.length && data.settings.coach) {
    const c = touch({ id: uid(), name: data.settings.coach, createdAt: Date.now() });
    data.coaches.push(c); data.settings.coachId = c.id; save();
  }
}
function showUpdate() {
  if ($('#update')) return;
  const d = document.createElement('div'); d.id = 'update';
  d.innerHTML = '<span>A new version is ready.</span><button class="btn small primary" id="upd-btn">Refresh</button>';
  document.body.appendChild(d); $('#upd-btn').onclick = () => location.reload();
}
(async function init() {
  data = await loadData(); migrate();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
  render(false);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) showUpdate(); });
    navigator.serviceWorker.register('sw.js').then(reg => {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
  }
  window.__mt = { get data() { return data; }, ui, buildSheets, buildCombinedSheets, mergeData, studentStats, actions, nowKL, APP_VERSION };
})();
})();
