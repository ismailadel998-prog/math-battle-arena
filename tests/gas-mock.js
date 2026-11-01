/*
 * Minimal Google Apps Script runtime emulator used ONLY for local testing.
 * Loads backend/Code.gs unchanged inside a sandbox with fake SpreadsheetApp,
 * CacheService, PropertiesService, LockService, ContentService and Utilities.
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const crypto = require("crypto");

function coerce(v) {               // behave like Sheets: numeric strings become numbers
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) && v.trim().length < 16) return Number(v);
  return v;
}

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) { const v = (this.sh.data[this.r - 1 + i] || [])[this.c - 1 + j]; row.push(v === undefined ? "" : v); }
      out.push(row);
    }
    return out;
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some(r => r.length !== this.nc)) throw new Error("Range size mismatch");
    vals.forEach((row, i) => row.forEach((v, j) => {
      const R = this.r - 1 + i; while (this.sh.data.length <= R) this.sh.data.push([]);
      this.sh.data[R][this.c - 1 + j] = coerce(v);
    }));
    return this;
  }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) { const row = this.sh.data[this.r - 1 + i]; if (row) row[this.c - 1 + j] = ""; } return this; }
  setFontWeight() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.data = []; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  getLastRow() { for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some(v => v !== "" && v !== undefined && v !== null)) return i + 1; return 0; }
  setFrozenRows() { }
  getName() { return this.name; }
}
class Spreadsheet {
  constructor() { this.sheets = {}; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { return (this.sheets[n] = new Sheet(n)); }
}

function createRuntime() {
  const ss = new Spreadsheet();
  const cache = new Map();
  const props = new Map();
  let timeOffset = 0;
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + timeOffset); }
    static now() { return RealDate.now() + timeOffset; }
  }
  const cacheGet = k => { const e = cache.get(k); if (!e) return null; if (e.exp < RealDate.now()) { cache.delete(k); return null; } return e.v; };
  const sandbox = {
    Date: FakeDate, Math, JSON, String, Number, Array, Object, isFinite, isNaN, Error,
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    CacheService: { getScriptCache: () => ({
      get: cacheGet,
      getAll: ks => { const o = {}; ks.forEach(k => { const v = cacheGet(k); if (v !== null) o[k] = v; }); return o; },
      put: (k, v, s = 600) => { if (String(v).length > 100000) throw new Error("Argument too large"); cache.set(k, { v: String(v), exp: RealDate.now() + s * 1000 }); },
      remove: k => cache.delete(k)
    }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.has(k) ? props.get(k) : null, setProperty: (k, v) => props.set(k, String(v)) }) },
    LockService: { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) },
    ContentService: { MimeType: { JSON: "application/json" }, createTextOutput: s => ({ content: s, setMimeType() { return this; }, getContent() { return s; } }) },
    Utilities: { getUuid: () => crypto.randomUUID(), sleep: () => { } }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "backend", "Code.gs"), "utf8"), sandbox, { filename: "Code.gs" });
  return {
    sandbox, ss, props,
    advance(ms) { timeOffset += ms; },
    doGet: params => JSON.parse(sandbox.doGet({ parameter: params }).getContent()),
    doPost: body => JSON.parse(sandbox.doPost({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } }).getContent()),
    sheet: name => { const s = ss.getSheetByName(name); return s ? s.data : []; }
  };
}
module.exports = { createRuntime };
