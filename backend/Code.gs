/**
 * MATH BATTLE ARENA — Google Apps Script backend
 * ------------------------------------------------
 * Paste this whole file into Extensions > Apps Script of your Google Sheet,
 * run setup() once, then Deploy > New deployment > Web app
 *   Execute as: Me      Who has access: Anyone
 *
 * The teacher password lives in Script Properties (TEACHER_PASSWORD),
 * never in the public website.
 */

var CFG = {
  DEFAULT_PASSWORD: 'Aa1234',   // only used by setup() the first time
  GAME_SECONDS: 420,            // 7 minutes
  QUESTION_SECONDS: 60,         // answers accepted for 60 s per question
  GRACE_MS: 2500,               // network allowance at the end of a timer
  TOKEN_SECONDS: 21600          // teacher login lasts 6 hours
};

var SCHEMA = {
  Students:     ['studentId', 'name', 'firstName', 'team', 'addedAt', 'className'],
  Teams:        ['team', 'teamName', 'mascot', 'color', 'score', 'players', 'updatedAt'],
  Rooms:        ['roomId', 'code', 'name', 'status', 'createdAt', 'className'],
  Players:      ['roomCode', 'studentId', 'name', 'team', 'deviceToken', 'joinedAt'],
  Questions:    ['qNum', 'question', 'A', 'B', 'C', 'D', 'answerKey'],
  Submissions:  ['submissionId', 'roomCode', 'qIndex', 'studentId', 'name', 'team', 'answer',
                 'seconds', 'status', 'points', 'manual', 'submittedAt', 'reviewedAt'],
  Scores:       ['roomCode', 'studentId', 'name', 'team', 'score', 'correct', 'answered', 'updatedAt'],
  GameSettings: ['key', 'value']
};

var DEFAULT_SETTINGS = {
  currentRoom: '', status: 'lobby', qIndex: -1, qStartedAt: 0, gameStartedAt: 0,
  pausedAt: 0, endedAt: 0, gameId: '', autoMark: true, gameSeconds: CFG.GAME_SECONDS, questionSeconds: CFG.QUESTION_SECONDS, bonusSeconds: 0
};

var DEFAULT_QUESTIONS = [
  // Lesson 3-8 part 1: "Times as many" -> multiply
  ['A school collected 1,326 cans for recycling. A second school collected 4 times as many cans. How many cans did the second school collect?', '1,330', '5,304', '4,304', '53,040', 'B'],
  ['Layla rode her bike 36 kilometers. Her uncle rode 14 times as far. How far did her uncle ride?', '50 km', '180 km', '504 km', '5,040 km', 'C'],
  // Lesson 3-8 part 2: Equal groups -> how many in all?
  ['A stadium has 24 sections. Each section has 135 seats. How many seats are there in all?', '3,240', '159', '810', '32,400', 'A'],
  ['A factory packs 16 boxes. Each box holds 225 pencils. How many pencils are packed in all?', '241', '1,575', '36,000', '3,600', 'D'],
  // Lesson 3-8 part 3: More than one step (solve the hidden question first)
  ['Hana has 38 stickers. Her brother has 6 times as many stickers as Hana. How many stickers do they have together?', '228', '44', '266', '190', 'C']
];

var TEAMS = [
  ['Blue', 'NUMBER NINJAS', 'Ninja', '#2f8cff'],
  ['Green', 'MATH TITANS', 'Titan', '#22d36f']
];

/* ============================ ENTRY POINTS ============================ */

function doGet(e) { return respond_(e && e.parameter ? e.parameter : {}); }

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'BAD_JSON', message: 'Invalid request.' }); }
  return respond_(body);
}

function respond_(p) {
  var out;
  try { out = route_(p || {}); }
  catch (err) {
    if (err && err.code) out = { ok: false, error: err.code, message: err.message };
    else out = { ok: false, error: 'SERVER', message: String(err && err.message || err) };
  }
  return json_(out);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function route_(p) {
  var now = Date.now();
  var a = String(p.action || 'ping');
  switch (a) {
    // ---- public (students + arena) ----
    case 'ping':         return { ok: true, service: 'Math Battle Arena', serverNow: now };
    case 'state':        return publicState_(p.code, now);
    case 'roster':       return roster_(p.code);
    case 'join':         return join_(p, now);
    case 'submit':       return submit_(p, now);
    // ---- teacher ----
    case 'login':        return login_(p);
    case 'logout':       requireTeacher_(p); CacheService.getScriptCache().remove('t_' + p.token); return { ok: true };
    case 'teacherState': requireTeacher_(p); return teacherState_(now);
    case 'createRoom':   requireTeacher_(p); return createRoom_(p, now);
    case 'control':      requireTeacher_(p); return control_(p, now);
    case 'review':       requireTeacher_(p); return review_(p, now);
    case 'bulkReview':   requireTeacher_(p); return bulkReview_(p, now);
    case 'adjust':       requireTeacher_(p); return adjust_(p, now);
    case 'uploadStudents': requireTeacher_(p); return uploadStudents_(p, now);
    case 'addStudent':   requireTeacher_(p); return uploadStudents_({ mode: 'append', className: p.className, students: [{ name: p.name, team: p.team }] }, now);
    case 'removeClass':  requireTeacher_(p); return removeClass_(p);
    case 'setTeam':      requireTeacher_(p); return setTeam_(p);
    case 'divideTeams':  requireTeacher_(p); return divideTeams_(p);
    case 'setAutoMark':  requireTeacher_(p); return setAutoMark_(p, now);
    case 'setTimes':     requireTeacher_(p); return setTimes_(p);
    case 'removeStudent':requireTeacher_(p); return removeStudent_(p);
    case 'releaseStudent': requireTeacher_(p); return releaseStudent_(p);
    default: throw err_('UNKNOWN', 'Unknown action: ' + a);
  }
}

/* ============================ SETUP ============================ */

/** Run this once from the Apps Script editor (select "setup" and press Run). */
function setup() {
  Object.keys(SCHEMA).forEach(function (name) { sheet_(name); });
  if (readRows_('Questions').length === 0) {
    appendRows_('Questions', DEFAULT_QUESTIONS.map(function (q, i) {
      return { qNum: i + 1, question: q[0], A: q[1], B: q[2], C: q[3], D: q[4], answerKey: q[5] };
    }));
  }
  if (readRows_('Teams').length === 0) {
    appendRows_('Teams', TEAMS.map(function (t) {
      return { team: t[0], teamName: t[1], mascot: t[2], color: t[3], score: 0, players: 0, updatedAt: '' };
    }));
  }
  var st = readSettings_();
  writeSettings_(st);
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TEACHER_PASSWORD')) props.setProperty('TEACHER_PASSWORD', CFG.DEFAULT_PASSWORD);
  bump_();
  return 'Setup complete';
}

/* ============================ SHEET HELPERS ============================ */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

var HEADER_OK_ = {};
function sheet_(name) {
  var s = ss_().getSheetByName(name), h = SCHEMA[name];
  if (!s) {
    s = ss_().insertSheet(name);
    s.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
    s.setFrozenRows(1);
  } else if (!HEADER_OK_[name]) {
    // adds columns introduced by newer versions (e.g. className) to an existing sheet
    var cur = s.getRange(1, 1, 1, h.length).getValues()[0];
    if (cur.join('|') !== h.join('|')) s.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
  }
  HEADER_OK_[name] = true;
  return s;
}

function readRows_(name) {
  var s = sheet_(name), h = SCHEMA[name], last = s.getLastRow();
  if (last < 2) return [];
  var vals = s.getRange(2, 1, last - 1, h.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var o = { _row: i + 2 }, blank = true;
    for (var j = 0; j < h.length; j++) { o[h[j]] = vals[i][j]; if (vals[i][j] !== '' && vals[i][j] !== null) blank = false; }
    if (!blank) out.push(o);
  }
  return out;
}

function toRow_(name, o) {
  return SCHEMA[name].map(function (k) { return (o[k] === undefined || o[k] === null) ? '' : o[k]; });
}

function appendRows_(name, objs) {
  if (!objs.length) return;
  var s = sheet_(name), h = SCHEMA[name];
  s.getRange(s.getLastRow() + 1, 1, objs.length, h.length)
   .setValues(objs.map(function (o) { return toRow_(name, o); }));
}

function updateRow_(name, o) {
  sheet_(name).getRange(o._row, 1, 1, SCHEMA[name].length).setValues([toRow_(name, o)]);
}

/** Replace every data row of a sheet with objs. */
function rewriteAll_(name, objs) {
  // Overwrite in place first, then clear only leftover rows, so a reader never sees an empty sheet.
  var s = sheet_(name), h = SCHEMA[name], last = s.getLastRow();
  if (objs.length) s.getRange(2, 1, objs.length, h.length).setValues(objs.map(function (o) { return toRow_(name, o); }));
  var extra = last - 1 - objs.length;
  if (extra > 0) s.getRange(objs.length + 2, 1, extra, h.length).clearContent();
}

function readSettings_() {
  var st = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) { st[k] = DEFAULT_SETTINGS[k]; });
  readRows_('GameSettings').forEach(function (r) { st[String(r.key)] = r.value; });
  var qi = st.qIndex;
  ['qStartedAt', 'gameStartedAt', 'pausedAt', 'endedAt', 'gameSeconds', 'questionSeconds', 'bonusSeconds']
    .forEach(function (k) { st[k] = Number(st[k]) || 0; });
  st.qIndex = (qi === '' || qi === null || isNaN(Number(qi))) ? -1 : Number(qi);
  st.currentRoom = String(st.currentRoom || '');
  st.status = String(st.status || 'lobby');
  st.gameId = String(st.gameId || '');
  st.autoMark = !(st.autoMark === false || String(st.autoMark).toUpperCase() === 'FALSE');
  if (!st.gameSeconds) st.gameSeconds = CFG.GAME_SECONDS;
  if (!st.questionSeconds) st.questionSeconds = CFG.QUESTION_SECONDS;
  return st;
}

function writeSettings_(st) {
  rewriteAll_('GameSettings', Object.keys(DEFAULT_SETTINGS).map(function (k) { return { key: k, value: st[k] }; }));
}

var IN_LOCK_ = false, BUMP_PENDING_ = false;

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(28000);
  IN_LOCK_ = true; BUMP_PENDING_ = false;
  try { return fn(); }
  finally {
    // Apps Script buffers sheet writes. Flush BEFORE releasing the lock, otherwise the next request
    // can read old data (and e.g. two simultaneous joins would write to the same row).
    try { SpreadsheetApp.flush(); } catch (e) { }
    if (BUMP_PENDING_) doBump_();      // invalidate the cache only after the data is really saved
    IN_LOCK_ = false; BUMP_PENDING_ = false;
    lock.releaseLock();
  }
}

/** Invalidate the cached public snapshot (called after every change). */
function bump_() { if (IN_LOCK_) BUMP_PENDING_ = true; else doBump_(); }
function doBump_() {
  CacheService.getScriptCache().put('ver', String(Date.now()) + Math.random().toString(36).slice(2, 7), 21600);
}

function err_(code, message) { return { code: code, message: message }; }
function str_(v) { return String(v === null || v === undefined ? '' : v).trim(); }
function up_(v) { return str_(v).toUpperCase(); }
function uid_(prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase(); }

/** Normalises Arabic / English names so duplicates are detected. */
function normName_(s) {
  return str_(s).normalize('NFD').replace(/[̀-ًͯ-ٰٟـ]/g, '')
    .toLowerCase().replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/\s+/g, ' ').trim();
}

function cleanName_(s) { return str_(s).replace(/\s+/g, ' '); }

function normTeam_(t) {
  var x = normName_(t);
  if (!x) return '';
  if (/^(blue|b|azraq|ازرق|الازرق|number ninjas|ninjas?|🔵)$/.test(x) || x.indexOf('blue') === 0 || x.indexOf('ازرق') >= 0) return 'Blue';
  if (/^(green|g|akhdar|اخضر|الاخضر|math titans|titans?|🟢)$/.test(x) || x.indexOf('green') === 0 || x.indexOf('اخضر') >= 0) return 'Green';
  return '';
}

/** Speed-based points for a CORRECT answer. */
/**
 * Speed-based points for a CORRECT answer. The bands follow the question time:
 * with 60 s they are exactly 0-10=100, 11-20=80, 21-30=60, 31-45=40, 46-60=20;
 * with 120 s they become 0-20, 21-40, 41-60, 61-90, 91-120.
 */
/** Total time answers are accepted: the visible countdown + the hidden bonus. */
function windowSec_(st) { return st.questionSeconds + (st.bonusSeconds || 0); }

function pointsFor_(seconds, questionSeconds) {
  var s = Number(seconds), k = (Number(questionSeconds) || 60) / 60;
  if (s <= 10 * k) return 100;
  if (s <= 20 * k) return 80;
  if (s <= 30 * k) return 60;
  if (s <= 45 * k) return 40;
  if (s <= 60 * k) return 20;
  return 0;
}

function timing_(st, now) {
  var eff = st.status === 'paused' ? st.pausedAt : (st.status === 'ended' ? (st.endedAt || now) : now);
  var qElapsed = (st.qIndex >= 0 && st.qStartedAt) ? Math.max(0, eff - st.qStartedAt) : 0;
  var gElapsed = st.gameStartedAt ? Math.max(0, eff - st.gameStartedAt) : 0;
  var gameOver = gElapsed >= st.gameSeconds * 1000;
  var qOver = qElapsed >= windowSec_(st) * 1000;          // includes the hidden bonus
  return {
    qElapsedMs: qElapsed, gameElapsedMs: gElapsed, gameTimeUp: gameOver, questionTimeUp: qOver,
    acceptingAnswers: st.status === 'running' && !gameOver && !qOver
  };
}

/* ============================ SCORES ============================ */

function computeScores_(code, subs, students, players) {
  var byId = {}, teamOf = {};
  (players || []).forEach(function (p) { if (str_(p.roomCode) === code) teamOf[str_(p.studentId)] = str_(p.team); });
  students.forEach(function (s) {
    var id = str_(s.studentId);
    byId[id] = { id: id, name: str_(s.name), team: teamOf[id] || '', score: 0, correct: 0, answered: 0 };
  });
  subs.forEach(function (x) {
    if (str_(x.roomCode) !== code) return;
    var id = str_(x.studentId);
    if (!byId[id]) byId[id] = { id: id, name: str_(x.name), team: teamOf[id] || str_(x.team), score: 0, correct: 0, answered: 0, removed: true };
    else if (!byId[id].team) byId[id].team = str_(x.team);
    byId[id].score += Number(x.points) || 0;
    byId[id].answered += 1;
    if (str_(x.status) === 'correct' || (str_(x.status) === 'adjusted' && Number(x.points) > 0)) byId[id].correct += 1;
  });
  var teams = { Blue: 0, Green: 0 };
  Object.keys(byId).forEach(function (k) { var p = byId[k]; if (teams[p.team] !== undefined) teams[p.team] += p.score; });
  return { players: byId, teams: teams };
}

function saveScores_(code, now) {
  var subs = readRows_('Submissions'), students = readRows_('Students');
  var players = readRows_('Players').filter(function (r) { return str_(r.roomCode) === code; });
  var sc = computeScores_(code, subs, students, players);
  var others = readRows_('Scores').filter(function (r) { return str_(r.roomCode) !== code; });
  var joined = {};
  players.forEach(function (p) { joined[str_(p.studentId)] = true; });
  var mine = Object.keys(sc.players).map(function (k) { return sc.players[k]; })
    .filter(function (p) { return joined[p.id] || p.answered > 0; })
    .map(function (p) {
      return { roomCode: code, studentId: p.id, name: p.name, team: p.team, score: p.score,
               correct: p.correct, answered: p.answered, updatedAt: new Date(now) };
    });
  rewriteAll_('Scores', others.concat(mine));
  var counts = { Blue: 0, Green: 0 };
  players.forEach(function (p) { var t = str_(p.team); if (counts[t] !== undefined) counts[t]++; });
  rewriteAll_('Teams', TEAMS.map(function (t) {
    return { team: t[0], teamName: t[1], mascot: t[2], color: t[3], score: sc.teams[t[0]], players: counts[t[0]], updatedAt: new Date(now) };
  }));
  return sc;
}

/* ============================ PUBLIC: STATE ============================ */

function findRoom_(code) {
  var room = null;
  if (code) readRows_('Rooms').forEach(function (r) {
    if (str_(r.code) === code) room = { code: code, name: str_(r.name), className: str_(r.className), createdAt: Number(r.createdAt) || 0 };
  });
  return room;
}

function inClass_(student, room) {
  return !room || !room.className || str_(student.className) === room.className;
}

function buildSnapshot_() {
  var st = readSettings_();
  var code = st.currentRoom;
  var room = findRoom_(code);
  var questions = readRows_('Questions').map(function (q) {
    return { text: str_(q.question), options: [str_(q.A), str_(q.B), str_(q.C), str_(q.D)] };
  });
  var students = readRows_('Students');
  var subs = code ? readRows_('Submissions').filter(function (x) { return str_(x.roomCode) === code; }) : [];
  var players = code ? readRows_('Players').filter(function (x) { return str_(x.roomCode) === code; }) : [];
  var sc = computeScores_(code, subs, students, players);
  var submittedByQ = {};
  subs.forEach(function (x) {
    var q = String(Number(x.qIndex));
    (submittedByQ[q] = submittedByQ[q] || []).push(str_(x.studentId));
  });
  var plist = players.map(function (p) {
    var id = str_(p.studentId), s = sc.players[id];
    return { id: id, name: s ? s.name : str_(p.name), team: str_(p.team), score: s ? s.score : 0 };
  });
  return { st: st, room: room, questions: questions, players: plist, teams: sc.teams, submittedByQ: submittedByQ };
}

function getSnapshot_() {
  var cache = CacheService.getScriptCache();
  var got = cache.getAll(['ver', 'pub']);
  var ver = got.ver;
  if (!ver) { bump_(); ver = cache.get('ver'); }
  if (got.pub) {
    try { var p = JSON.parse(got.pub); if (p.ver === ver) return p; } catch (e) { }
  }
  var snap = buildSnapshot_();
  snap.ver = ver;
  try { cache.put('pub', JSON.stringify(snap), 120); } catch (e) { }
  return snap;
}

function publicState_(code, now) {
  var snap = getSnapshot_();
  var st = snap.st;
  code = up_(code);
  if (code && (!snap.room || snap.room.code !== code)) {
    throw err_('ROOM_CLOSED', 'This room code is not active. Check the code with your teacher.');
  }
  var t = timing_(st, now);
  var showQ = (st.status === 'running' || st.status === 'paused') && st.qIndex >= 0 && st.qIndex < snap.questions.length;
  var ids = showQ ? (snap.submittedByQ[String(st.qIndex)] || []) : [];
  var winner = '';
  if (st.status === 'ended') winner = snap.teams.Blue > snap.teams.Green ? 'Blue' : (snap.teams.Green > snap.teams.Blue ? 'Green' : 'Tie');
  return {
    ok: true, serverNow: now, room: snap.room, status: st.status, gameId: st.gameId, autoMark: st.autoMark,
    qIndex: st.qIndex, qCount: snap.questions.length,
    question: showQ ? snap.questions[st.qIndex] : null,
    qElapsedMs: t.qElapsedMs, qSeconds: st.questionSeconds, bonusSeconds: st.bonusSeconds,
    gameElapsedMs: t.gameElapsedMs, gameSeconds: st.gameSeconds,
    gameTimeUp: t.gameTimeUp, questionTimeUp: t.questionTimeUp, acceptingAnswers: t.acceptingAnswers,
    submittedIds: ids, submittedCount: ids.length, joinedCount: snap.players.length,
    players: snap.players, teams: snap.teams, winner: winner
  };
}

/* ============================ PUBLIC: JOIN ============================ */

function roster_(code) {
  code = up_(code);
  var snap = getSnapshot_();
  if (!code || !snap.room || snap.room.code !== code) {
    throw err_('ROOM_CLOSED', 'This room code is not active. Check the code with your teacher.');
  }
  var joined = {};
  snap.players.forEach(function (p) { joined[p.id] = true; });
  var list = readRows_('Students').filter(function (s) { return inClass_(s, snap.room); }).map(function (s) {
    return { id: str_(s.studentId), name: str_(s.name), joined: !!joined[str_(s.studentId)] };
  });
  return { ok: true, room: snap.room, students: list };
}

function join_(p, now) {
  var code = up_(p.code), sid = str_(p.studentId), tok = str_(p.deviceToken);
  if (!code || !sid || tok.length < 8) throw err_('BAD_REQUEST', 'Missing information.');
  return withLock_(function () {
    var st = readSettings_();
    if (st.currentRoom !== code) throw err_('ROOM_CLOSED', 'This room code is not active. Check the code with your teacher.');
    var student = null;
    readRows_('Students').forEach(function (s) { if (str_(s.studentId) === sid) student = s; });
    if (!student) throw err_('NOT_IN_LIST', 'Your name is not on the class list. Ask your teacher.');
    if (!inClass_(student, findRoom_(code))) throw err_('NOT_IN_LIST', 'Your name is not on the list for this room. Check the room code with your teacher.');
    var team = '';
    var players = readRows_('Players').filter(function (r) { return str_(r.roomCode) === code; });
    var mine = null, deviceUsed = null;
    players.forEach(function (r) {
      if (str_(r.studentId) === sid) mine = r;
      else if (str_(r.deviceToken) === tok) deviceUsed = r;
    });
    if (mine) {
      if (str_(mine.deviceToken) !== tok) throw err_('ALREADY_JOINED', 'This name has already joined the game on another device. If this is you, ask your teacher to release your name.');
      team = str_(mine.team);
    } else {
      if (deviceUsed) throw err_('DEVICE_USED', 'This device already joined as ' + str_(deviceUsed.name) + '.');
      var divided = st.status !== 'lobby' || players.some(function (r) { return str_(r.team); });
      if (divided) team = smallerTeam_(players);
      appendRows_('Players', [{ roomCode: code, studentId: sid, name: str_(student.name), team: team, deviceToken: tok, joinedAt: now }]);
      bump_();
    }
    return { ok: true, student: { id: sid, name: str_(student.name), team: team }, rejoined: !!mine };
  });
}

/* ============================ PUBLIC: SUBMIT ============================ */

function submit_(p, now) {
  var code = up_(p.code), sid = str_(p.studentId), tok = str_(p.deviceToken);
  var q = Number(p.qIndex), ans = up_(p.answer);
  if (['A', 'B', 'C', 'D'].indexOf(ans) < 0) throw err_('BAD_ANSWER', 'Choose A, B, C or D.');
  return withLock_(function () {
    var st = readSettings_();
    if (st.currentRoom !== code) throw err_('ROOM_CLOSED', 'This room is closed.');
    if (st.status === 'paused') throw err_('PAUSED', 'The game is paused. Wait for your teacher.');
    if (st.status !== 'running') throw err_('NOT_RUNNING', 'The game is not running.');
    if (q !== st.qIndex) throw err_('WRONG_QUESTION', 'That question is no longer active.');
    var player = null;
    readRows_('Players').forEach(function (r) { if (str_(r.roomCode) === code && str_(r.studentId) === sid) player = r; });
    if (!player || str_(player.deviceToken) !== tok) throw err_('NOT_JOINED', 'Please join the game first.');
    var subs = readRows_('Submissions');
    for (var i = 0; i < subs.length; i++) {
      var x = subs[i];
      if (str_(x.roomCode) === code && Number(x.qIndex) === q && str_(x.studentId) === sid) {
        throw err_('DUPLICATE', 'You already answered this question (' + str_(x.answer) + ').');
      }
    }
    var t = timing_(st, now);
    if (t.qElapsedMs > windowSec_(st) * 1000 + CFG.GRACE_MS || t.gameElapsedMs > st.gameSeconds * 1000 + CFG.GRACE_MS) {
      throw err_('TIME_UP', "Time's up for this question.");
    }
    var seconds = Math.min(windowSec_(st), Math.floor(t.qElapsedMs / 1000));
    var team = str_(player.team);
    var status = 'pending', points = 0, reviewedAt = '';
    if (st.autoMark) {
      var key = answerKey_(q);
      if (key) { status = ans === key ? 'correct' : 'incorrect'; points = status === 'correct' ? pointsFor_(seconds, windowSec_(st)) : 0; reviewedAt = now; }
    }
    appendRows_('Submissions', [{
      submissionId: uid_('X'), roomCode: code, qIndex: q, studentId: sid, name: str_(player.name), team: team,
      answer: ans, seconds: seconds, status: status, points: points, manual: false, submittedAt: now, reviewedAt: reviewedAt
    }]);
    bump_();
    return { ok: true, answer: ans, seconds: seconds, qIndex: q };
  });
}

/* ============================ TEACHER ============================ */

function login_(p) {
  var real = PropertiesService.getScriptProperties().getProperty('TEACHER_PASSWORD') || CFG.DEFAULT_PASSWORD;
  if (str_(p.password) !== real) {
    Utilities.sleep(1000);   // slows down guessing
    throw err_('BAD_PASSWORD', 'Wrong password.');
  }
  var token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('t_' + token, '1', CFG.TOKEN_SECONDS);
  return { ok: true, token: token, expiresIn: CFG.TOKEN_SECONDS };
}

function requireTeacher_(p) {
  var tok = str_(p.token);
  if (!tok || !CacheService.getScriptCache().get('t_' + tok)) throw err_('AUTH', 'Please log in again.');
}

function teacherState_(now) {
  var st = readSettings_();
  var code = st.currentRoom;
  var room = findRoom_(code);
  var students = readRows_('Students');
  var classes = {};
  students.forEach(function (s) { var c = str_(s.className); if (c) classes[c] = (classes[c] || 0) + 1; });
  var subs = readRows_('Submissions').filter(function (x) { return code && str_(x.roomCode) === code; });
  var players = readRows_('Players').filter(function (x) { return code && str_(x.roomCode) === code; });
  var sc = computeScores_(code, subs, students, players);
  var joined = {};
  players.forEach(function (p) { joined[str_(p.studentId)] = Number(p.joinedAt) || 1; });
  return {
    ok: true, serverNow: now, settings: st, room: room, timing: timing_(st, now),
    classes: Object.keys(classes).sort().map(function (c) { return { name: c, count: classes[c] }; }),
    questions: readRows_('Questions').map(function (q) {
      return { text: str_(q.question), options: [str_(q.A), str_(q.B), str_(q.C), str_(q.D)], answerKey: up_(q.answerKey) };
    }),
    students: students.map(function (s) {
      var id = str_(s.studentId), p = sc.players[id];
      return { id: id, name: str_(s.name), team: p ? p.team : '', className: str_(s.className), joinedAt: joined[id] || 0, score: p ? p.score : 0, correct: p ? p.correct : 0 };
    }),
    submissions: subs.map(function (x) {
      return { id: str_(x.submissionId), qIndex: Number(x.qIndex), studentId: str_(x.studentId), name: str_(x.name),
        team: (sc.players[str_(x.studentId)] || {}).team || str_(x.team), answer: str_(x.answer), seconds: Number(x.seconds),
        status: str_(x.status) || 'pending', points: Number(x.points) || 0, manual: x.manual === true || str_(x.manual) === 'TRUE',
        submittedAt: Number(x.submittedAt) || 0 };
    }),
    teams: sc.teams
  };
}

function createRoom_(p, now) {
  var className = cleanName_(p.className);
  var name = cleanName_(p.name) || (className ? className + ' Battle' : 'Grade 5 Battle');
  return withLock_(function () {
    var rooms = readRows_('Rooms');
    var used = {};
    rooms.forEach(function (r) { used[str_(r.code)] = true; if (str_(r.status) !== 'closed') { r.status = 'closed'; updateRow_('Rooms', r); } });
    var letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ', code;
    do {
      code = '';
      for (var i = 0; i < 5; i++) code += letters.charAt(Math.floor(Math.random() * letters.length));
    } while (used[code]);
    appendRows_('Rooms', [{ roomId: uid_('R'), code: code, name: name, status: 'lobby', createdAt: now, className: className }]);
    var st = readSettings_();
    st.currentRoom = code; st.status = 'lobby'; st.qIndex = -1;
    st.qStartedAt = 0; st.gameStartedAt = 0; st.pausedAt = 0; st.endedAt = 0;
    writeSettings_(st);
    saveScores_(code, now);
    bump_();
    return { ok: true, room: { code: code, name: name, className: className } };
  });
}

function setRoomStatus_(code, status) {
  readRows_('Rooms').forEach(function (r) { if (str_(r.code) === code && str_(r.status) !== status) { r.status = status; updateRow_('Rooms', r); } });
}

function control_(p, now) {
  var cmd = str_(p.cmd);
  return withLock_(function () {
    var st = readSettings_();
    if (!st.currentRoom) throw err_('NO_ROOM', 'Create a room first.');
    var qCount = readRows_('Questions').length;
    var frozen = st.status === 'paused' ? st.pausedAt : now;
    switch (cmd) {
      case 'start':
        if (st.status === 'running' || st.status === 'paused') throw err_('BAD_STATE', 'The game is already running.');
        if (st.status === 'ended') throw err_('BAD_STATE', 'This game has ended. Press Reset to play again.');
        if (!qCount) throw err_('NO_QUESTIONS', 'Add questions first.');
        assignTeams_(st.currentRoom, false);
        st.status = 'running'; st.gameId = uid_('G'); st.qIndex = 0; st.qStartedAt = now; st.gameStartedAt = now; st.pausedAt = 0; st.endedAt = 0;
        break;
      case 'pause':
        if (st.status !== 'running') throw err_('BAD_STATE', 'The game is not running.');
        st.status = 'paused'; st.pausedAt = now;
        break;
      case 'resume':
        if (st.status !== 'paused') throw err_('BAD_STATE', 'The game is not paused.');
        var d = now - st.pausedAt;
        st.gameStartedAt += d; st.qStartedAt += d; st.pausedAt = 0; st.status = 'running';
        break;
      case 'next':
      case 'prev':
        if (st.status !== 'running' && st.status !== 'paused') throw err_('BAD_STATE', 'Start the game first.');
        var ni = st.qIndex + (cmd === 'next' ? 1 : -1);
        if (ni < 0 || ni >= qCount) throw err_('BAD_STATE', cmd === 'next' ? 'This is the last question.' : 'This is the first question.');
        st.qIndex = ni; st.qStartedAt = frozen;
        break;
      case 'end':
        if (st.status !== 'running' && st.status !== 'paused') throw err_('BAD_STATE', 'The game is not running.');
        st.endedAt = frozen; st.status = 'ended';
        break;
      case 'reset':
        st.status = 'lobby'; st.gameId = ''; st.qIndex = -1; st.qStartedAt = 0; st.gameStartedAt = 0; st.pausedAt = 0; st.endedAt = 0;
        var keep = readRows_('Submissions').filter(function (x) { return str_(x.roomCode) !== st.currentRoom; });
        rewriteAll_('Submissions', keep);
        break;
      default: throw err_('BAD_REQUEST', 'Unknown command.');
    }
    writeSettings_(st);
    setRoomStatus_(st.currentRoom, st.status);
    if (cmd === 'reset' || cmd === 'end') saveScores_(st.currentRoom, now);
    bump_();
    return { ok: true, status: st.status, qIndex: st.qIndex };
  });
}

function review_(p, now) {
  var id = str_(p.submissionId), status = str_(p.status);
  if (['correct', 'incorrect', 'pending'].indexOf(status) < 0) throw err_('BAD_REQUEST', 'Bad status.');
  return withLock_(function () {
    var st = readSettings_();
    var x = null;
    readRows_('Submissions').forEach(function (r) { if (str_(r.submissionId) === id) x = r; });
    if (!x) throw err_('NOT_FOUND', 'Submission not found.');
    x.status = status;
    x.points = status === 'correct' ? pointsFor_(x.seconds, windowSec_(st)) : 0;   // points are SET, never added: no double scoring
    x.manual = false;
    x.reviewedAt = status === 'pending' ? '' : now;
    updateRow_('Submissions', x);
    var sc = saveScores_(str_(x.roomCode) || st.currentRoom, now);
    bump_();
    return { ok: true, submissionId: id, status: x.status, points: x.points, teams: sc.teams };
  });
}

function bulkReview_(p, now) {
  var q = Number(p.qIndex), ans = up_(p.answer);
  if (['A', 'B', 'C', 'D'].indexOf(ans) < 0) throw err_('BAD_REQUEST', 'Choose the correct letter.');
  return withLock_(function () {
    var st = readSettings_();
    var all = readRows_('Submissions'), changed = 0;
    all.forEach(function (x) {
      if (str_(x.roomCode) !== st.currentRoom || Number(x.qIndex) !== q || str_(x.status) !== 'pending') return;
      x.status = up_(x.answer) === ans ? 'correct' : 'incorrect';
      x.points = x.status === 'correct' ? pointsFor_(x.seconds, windowSec_(st)) : 0;
      x.manual = false; x.reviewedAt = now;
      updateRow_('Submissions', x);
      changed++;
    });
    var sc = saveScores_(st.currentRoom, now);
    bump_();
    return { ok: true, changed: changed, teams: sc.teams };
  });
}

function adjust_(p, now) {
  var id = str_(p.submissionId), pts = Math.round(Number(p.points));
  if (!isFinite(pts) || pts < 0 || pts > 1000) throw err_('BAD_REQUEST', 'Points must be between 0 and 1000.');
  return withLock_(function () {
    var x = null;
    readRows_('Submissions').forEach(function (r) { if (str_(r.submissionId) === id) x = r; });
    if (!x) throw err_('NOT_FOUND', 'Submission not found.');
    x.status = 'adjusted'; x.points = pts; x.manual = true; x.reviewedAt = now;
    updateRow_('Submissions', x);
    var sc = saveScores_(str_(x.roomCode), now);
    bump_();
    return { ok: true, points: pts, teams: sc.teams };
  });
}

function uploadStudents_(p, now) {
  var list = Array.isArray(p.students) ? p.students : [];
  var mode = str_(p.mode) === 'replace' ? 'replace' : 'append';
  var className = cleanName_(p.className);
  return withLock_(function () {
    var all = readRows_('Students');
    var others = all.filter(function (s) { return str_(s.className) !== className; });
    var existing = mode === 'replace' ? [] : all.filter(function (s) { return str_(s.className) === className; });
    var seen = {};
    existing.forEach(function (s) { seen[normName_(s.name)] = true; });
    var added = [], skipped = [];
    list.forEach(function (it) {
      var name = cleanName_(it && it.name);
      if (!name) return;
      var key = normName_(name);
      if (seen[key]) { skipped.push(name); return; }
      seen[key] = true;
      added.push({ studentId: uid_('S'), name: name, firstName: name.split(' ')[0], team: normTeam_(it.team), addedAt: now, className: className });
    });
    if (mode === 'replace') {
      var keep = others.concat(added);
      rewriteAll_('Students', keep);
      var ids = {};
      keep.forEach(function (s) { ids[str_(s.studentId)] = true; });
      rewriteAll_('Players', readRows_('Players').filter(function (r) { return ids[str_(r.studentId)]; }));
    } else {
      appendRows_('Students', added);
    }
    bump_();
    return { ok: true, added: added.length, skipped: skipped };
  });
}

/* ---------- teams are made AFTER students join (one set of teams per room) ---------- */

function smallerTeam_(players) {
  var c = { Blue: 0, Green: 0 };
  players.forEach(function (r) { if (c[str_(r.team)] !== undefined) c[str_(r.team)]++; });
  if (c.Blue === c.Green) return Math.random() < 0.5 ? 'Blue' : 'Green';
  return c.Blue < c.Green ? 'Blue' : 'Green';
}

/** Splits the room's joined players into two even teams. reshuffle=false only places players without a team. */
function assignTeams_(code, reshuffle) {
  var all = readRows_('Players');
  var mine = all.filter(function (r) { return str_(r.roomCode) === code; });
  var todo = mine.filter(function (r) { return reshuffle || !str_(r.team); });
  if (!todo.length) return { changed: 0 };
  for (var i = todo.length - 1; i > 0; i--) {           // random order
    var j = Math.floor(Math.random() * (i + 1)), t = todo[i]; todo[i] = todo[j]; todo[j] = t;
  }
  if (reshuffle) todo.forEach(function (r) { r.team = ''; });
  todo.forEach(function (r) { r.team = smallerTeam_(mine); });
  rewriteAll_('Players', all);
  return { changed: todo.length };
}

function divideTeams_(p) {
  return withLock_(function () {
    var st = readSettings_();
    if (!st.currentRoom) throw err_('NO_ROOM', 'Create a room first.');
    var reshuffle = p.reshuffle !== false && st.status === 'lobby';   // once the game started, keep existing teams
    var r = assignTeams_(st.currentRoom, reshuffle);
    var c = { Blue: 0, Green: 0 };
    readRows_('Players').forEach(function (x) { if (str_(x.roomCode) === st.currentRoom && c[str_(x.team)] !== undefined) c[str_(x.team)]++; });
    bump_();
    return { ok: true, changed: r.changed, counts: c };
  });
}

function setTeam_(p) {
  var id = str_(p.studentId), team = normTeam_(p.team);
  if (!team) throw err_('BAD_REQUEST', 'Choose Blue or Green.');
  return withLock_(function () {
    var st = readSettings_(), found = false;
    readRows_('Players').forEach(function (r) {
      if (str_(r.roomCode) === st.currentRoom && str_(r.studentId) === id) { r.team = team; updateRow_('Players', r); found = true; }
    });
    if (!found) throw err_('NOT_JOINED', 'This student has not joined the room yet.');
    if (st.status !== 'lobby') saveScores_(st.currentRoom, Date.now());
    bump_();
    return { ok: true, team: team };
  });
}

function removeStudent_(p) {
  var id = str_(p.studentId);
  return withLock_(function () {
    rewriteAll_('Students', readRows_('Students').filter(function (s) { return str_(s.studentId) !== id; }));
    rewriteAll_('Players', readRows_('Players').filter(function (r) { return str_(r.studentId) !== id; }));
    bump_();
    return { ok: true };
  });
}

function releaseStudent_(p) {
  var id = str_(p.studentId);
  return withLock_(function () {
    var st = readSettings_();
    rewriteAll_('Players', readRows_('Players').filter(function (r) { return !(str_(r.studentId) === id && str_(r.roomCode) === st.currentRoom); }));
    bump_();
    return { ok: true };
  });
}

function removeClass_(p) {
  var className = cleanName_(p.className);
  if (!className) throw err_('BAD_REQUEST', 'Choose a class.');
  return withLock_(function () {
    var all = readRows_('Students');
    var keep = all.filter(function (s) { return str_(s.className) !== className; });
    rewriteAll_('Students', keep);
    var ids = {};
    keep.forEach(function (s) { ids[str_(s.studentId)] = true; });
    rewriteAll_('Players', readRows_('Players').filter(function (r) { return ids[str_(r.studentId)]; }));
    bump_();
    return { ok: true, removed: all.length - keep.length };
  });
}

/* ---------- automatic marking (uses the answer key in the Questions sheet) ---------- */

function answerKey_(qIndex) {
  var q = readRows_('Questions')[qIndex];
  var k = q ? up_(q.answerKey) : '';
  return ['A', 'B', 'C', 'D'].indexOf(k) >= 0 ? k : '';
}

function setAutoMark_(p, now) {
  var on = p.on === true || String(p.on).toLowerCase() === 'true';
  return withLock_(function () {
    var st = readSettings_();
    st.autoMark = on;
    writeSettings_(st);
    var changed = 0;
    if (on && st.currentRoom) {          // score answers that are still waiting
      var keys = readRows_('Questions').map(function (q) { return up_(q.answerKey); });
      readRows_('Submissions').forEach(function (x) {
        if (str_(x.roomCode) !== st.currentRoom || str_(x.status) !== 'pending') return;
        var key = keys[Number(x.qIndex)];
        if (['A', 'B', 'C', 'D'].indexOf(key) < 0) return;
        x.status = up_(x.answer) === key ? 'correct' : 'incorrect';
        x.points = x.status === 'correct' ? pointsFor_(x.seconds, windowSec_(st)) : 0;
        x.manual = false; x.reviewedAt = now;
        updateRow_('Submissions', x);
        changed++;
      });
      if (changed) saveScores_(st.currentRoom, now);
    }
    bump_();
    return { ok: true, autoMark: on, changed: changed };
  });
}

/** Time per question and total game time, chosen in the dashboard before a game starts. */
function setTimes_(p) {
  var q = Math.round(Number(p.questionSeconds)), g = Math.round(Number(p.gameSeconds)), b = Math.round(Number(p.bonusSeconds) || 0);
  if (!(q >= 10 && q <= 600) || !(g >= 60 && g <= 3600) || !(b >= 0 && b <= 300)) throw err_('BAD_REQUEST', 'Choose a time per question (10 s to 10 min), a bonus (0 to 5 min) and a game time (1 to 60 min).');
  return withLock_(function () {
    var st = readSettings_();
    if (st.status === 'running' || st.status === 'paused') throw err_('BAD_STATE', 'Change the times before you start (or after Reset).');
    st.questionSeconds = q; st.gameSeconds = g; st.bonusSeconds = b;
    writeSettings_(st);
    bump_();
    return { ok: true, questionSeconds: q, gameSeconds: g, bonusSeconds: b };
  });
}
