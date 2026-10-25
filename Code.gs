/**
 * Modern Taekwondo Attendance - Google Sheets connector (version 1.2)
 *
 * HOW TO USE
 * 1. In your Google Sheet: Extensions > Apps Script. Delete the sample code, paste this whole file.
 * 2. Change SECRET below to your own secret word (the same word goes into the app's Settings).
 * 3. Deploy > New deployment > type "Web app".
 *      Execute as: Me
 *      Who has access: Anyone
 *    Allow the permissions, then copy the Web app URL into the app's Settings.
 * 4. In the app: Settings > Test, then Sync now.
 *
 * UPDATING THIS CODE LATER (the Web app URL stays the same):
 *    Paste the new code, save, then Deploy > Manage deployments > pencil icon >
 *    Version: "New version" > Deploy.
 */
const SECRET = 'change-this-secret';   // <-- change me (keep the quote marks)
const DATA_SHEET = '_data';            // hidden sheet that stores the shared data (do not edit)
const CHUNK = 40000;                   // a Google Sheets cell holds at most 50,000 characters
const MAX_COL_PX = 260;                // columns are never wider than this

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.key !== SECRET) return out_({ ok: false, error: 'Wrong secret key' });
    if (p.ping) return out_({ ok: true, pong: true });
    return out_({ ok: true, data: readData_() });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const body = JSON.parse(e.postData.contents);
    if (body.key !== SECRET) return out_({ ok: false, error: 'Wrong secret key' });
    if (body.data) writeData_(body.data);
    if (body.sheets) writeSheets_(body.sheets);
    return out_({ ok: true, time: new Date().toISOString() });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* ignore */ }
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function dataSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(DATA_SHEET);
  if (!sh) {
    sh = ss.insertSheet(DATA_SHEET);
    try { sh.hideSheet(); } catch (x) { /* ignore */ }
  }
  return sh;
}

function readData_() {
  const sh = dataSheet_();
  const n = sh.getLastRow();
  if (n < 1) return null;
  const text = sh.getRange(1, 1, n, 1).getValues().map(r => r[0]).join('');
  return text ? JSON.parse(text) : null;
}

function writeData_(data) {
  const sh = dataSheet_();
  const text = JSON.stringify(data);
  const rows = [];
  for (let i = 0; i < text.length; i += CHUNK) rows.push([text.substring(i, i + CHUNK)]);
  sh.clearContents();
  if (rows.length) sh.getRange(1, 1, rows.length, 1).setValues(rows);
}

function writeSheets_(sheets) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  const previous = JSON.parse(props.getProperty('APP_SHEETS') || '[]');
  const names = [];
  sheets.forEach(function (s) {
    let sh = ss.getSheetByName(s.name);
    if (!sh) sh = ss.insertSheet(s.name);
    sh.clear();   // removes old content AND old formatting
    const width = s.rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
    const rows = s.rows.map(function (r) {
      const c = r.slice();
      while (c.length < width) c.push('');
      return c;
    });
    if (rows.length) {
      sh.getRange(1, 1, rows.length, width).setValues(rows);
      format_(sh, s, rows, width);
    }
    names.push(s.name);
  });
  // remove sheets this script created earlier that no longer exist (for example a renamed school)
  previous.forEach(function (old) {
    if (names.indexOf(old) === -1) {
      const sh = ss.getSheetByName(old);
      if (sh && ss.getSheets().length > 1) ss.deleteSheet(sh);
    }
  });
  props.setProperty('APP_SHEETS', JSON.stringify(names));
  // remove the default empty "Sheet1" if it is still empty and untouched
  const first = ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
}

// Applies the look: only header rows bold, colours per school/class, borders, thick line round each school.
function format_(sh, s, rows, width) {
  const n = rows.length;
  const weights = [], bg = [], align = [];
  for (let r = 0; r < n; r++) {
    weights.push(new Array(width).fill('normal'));
    bg.push(new Array(width).fill(null));
    align.push(rows[r].map(function (v) {
      return (typeof v === 'string' && v.length > 0 && v.length <= 2) ? 'center' : 'normal';   // ticks and crosses
    }));
  }
  (s.bold || []).forEach(function (r) { if (weights[r]) weights[r].fill('bold'); });
  (s.fills || []).forEach(function (f) {
    if (!bg[f.r]) return;
    for (let c = f.c0; c <= Math.min(f.c1, width - 1); c++) bg[f.r][c] = '#' + f.color;
  });
  const all = sh.getRange(1, 1, n, width);
  all.setFontWeights(weights);
  all.setBackgrounds(bg);
  all.setHorizontalAlignments(align);
  all.setVerticalAlignment('middle');
  (s.grid || []).forEach(function (g) {
    sh.getRange(g.r + 1, g.c + 1, g.h, g.w)
      .setBorder(true, true, true, true, true, true, '#9E9E9E', SpreadsheetApp.BorderStyle.SOLID);
  });
  (s.outline || []).forEach(function (g) {
    sh.getRange(g.r + 1, g.c + 1, g.h, g.w)
      .setBorder(true, true, true, true, false, false, '#000000', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  });
  sh.setFrozenRows(s.freeze || 0);
  sh.autoResizeColumns(1, width);
  for (let c = 1; c <= width; c++) {
    if (sh.getColumnWidth(c) > MAX_COL_PX) sh.setColumnWidth(c, MAX_COL_PX);
  }
}
