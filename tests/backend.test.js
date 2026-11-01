/* Backend rule tests: runs backend/Code.gs in the emulator. Usage: node tests/backend.test.js */
const assert = require("assert");
const { createRuntime } = require("./gas-mock");
let passed = 0;
function t(name, fn) { fn(); passed++; console.log("  ✔ " + name); }

const rt = createRuntime();
rt.sandbox.setup();
const P = b => rt.doPost(b), G = p => rt.doGet(p);

t("teacher password is checked on the server", () => {
  assert.strictEqual(P({ action: "login", password: "wrong" }).error, "BAD_PASSWORD");
  assert.strictEqual(P({ action: "teacherState", token: "fake" }).error, "AUTH");
  assert.strictEqual(P({ action: "control", cmd: "start" }).error, "AUTH");
});
const token = P({ action: "login", password: "Aa1234" }).token;
assert(token);
const T = b => P({ token, ...b });

t("automatic marking is ON by default, and can be switched off", () => {
  assert.strictEqual(T({ action: "teacherState" }).settings.autoMark, true);
  assert.strictEqual(T({ action: "setAutoMark", on: false }).autoMark, false);
  assert.strictEqual(T({ action: "teacherState" }).settings.autoMark, false);
});

t("6 default questions created", () => assert.strictEqual(T({ action: "teacherState" }).questions.length, 6));

t("upload students, duplicates skipped (incl. Arabic spelling variants)", () => {
  const r = T({ action: "uploadStudents", mode: "replace", students: [
    { name: "Mohamed Adel", team: "Blue" }, { name: "Mohamed Ahmed", team: "green" }, { name: "Hossam Mohamed", team: "Green" },
    { name: "Mahmoud Hassan", team: "" }, { name: "mohamed  adel", team: "Blue" }, { name: "أحمد علي", team: "أزرق" }, { name: "احمد علي", team: "" },
    { name: "سارة خالد", team: "أخضر" }] });
  assert.strictEqual(r.added, 6); assert.strictEqual(r.skipped.length, 2);
  const st = T({ action: "teacherState" }).students;
  assert(st.every(s => s.team === ""), "nobody has a team before joining");
});

let code;
t("create room gives a 5-letter code", () => { code = T({ action: "createRoom", name: "5A" }).room.code; assert(/^[A-Z]{5}$/.test(code)); });

const S = () => T({ action: "teacherState" }).students;
const id = n => S().find(s => s.name === n).id;

t("joining needs a valid room and a listed student (no team needed)", () => {
  assert.strictEqual(P({ action: "join", code: "ZZZZZ", studentId: id("Mohamed Adel"), deviceToken: "dev-aaaaaaaa" }).error, "ROOM_CLOSED");
  assert.strictEqual(P({ action: "join", code, studentId: "S-NOPE", deviceToken: "dev-aaaaaaaa" }).error, "NOT_IN_LIST");
});

t("join + duplicate registration prevented", () => {
  const a = P({ action: "join", code, studentId: id("Mohamed Adel"), deviceToken: "dev-aaaaaaaa" });
  assert(a.ok); assert.strictEqual(a.student.team, "", "no team yet after joining");
  assert(P({ action: "join", code, studentId: id("Mohamed Adel"), deviceToken: "dev-aaaaaaaa" }).rejoined, "same device can rejoin after refresh");
  assert.strictEqual(P({ action: "join", code, studentId: id("Mohamed Adel"), deviceToken: "dev-otherrrr" }).error, "ALREADY_JOINED");
  assert.strictEqual(P({ action: "join", code, studentId: id("Mohamed Ahmed"), deviceToken: "dev-aaaaaaaa" }).error, "DEVICE_USED");
  assert(P({ action: "join", code, studentId: id("Mohamed Ahmed"), deviceToken: "dev-bbbbbbbb" }).ok);
  assert(P({ action: "join", code, studentId: id("Hossam Mohamed"), deviceToken: "dev-cccccccc" }).ok);
  assert(P({ action: "join", code, studentId: id("أحمد علي"), deviceToken: "dev-dddddddd" }).ok);
});

const sub = (name, dev, q, ans) => P({ action: "submit", code, studentId: id(name), deviceToken: dev, qIndex: q, answer: ans });

t("teacher divides the joined players into two even random teams", () => {
  assert.strictEqual(T({ action: "setTeam", studentId: id("Mahmoud Hassan"), team: "Blue" }).error, "NOT_JOINED");
  const r = T({ action: "divideTeams" });
  assert.deepStrictEqual(r.counts, { Blue: 2, Green: 2 });
  const s = G({ action: "state", code });
  assert(s.players.every(p => p.team === "Blue" || p.team === "Green"));
  // fix the teams so the scoring checks below are predictable
  [["Mohamed Adel", "Blue"], ["Mohamed Ahmed", "Green"], ["Hossam Mohamed", "Green"], ["أحمد علي", "Blue"]]
    .forEach(([n, tm]) => assert(T({ action: "setTeam", studentId: id(n), team: tm }).ok));
  assert(P({ action: "join", code, studentId: id("Mohamed Adel"), deviceToken: "dev-aaaaaaaa" }).student.team === "Blue", "rejoin keeps the team");
});

t("cannot answer before the game starts", () => assert.strictEqual(sub("Mohamed Adel", "dev-aaaaaaaa", 0, "A").error, "NOT_RUNNING"));
t("start game -> everyone sees question 1, answer key hidden from students", () => {
  T({ action: "control", cmd: "start" });
  const s = G({ action: "state", code });
  assert.strictEqual(s.status, "running"); assert.strictEqual(s.qIndex, 0);
  assert.strictEqual(s.question.options.length, 4);
  assert(!JSON.stringify(s).includes("answerKey"));
});

t("submission time and single submission per question", () => {
  rt.advance(5000);
  const a = sub("Mohamed Adel", "dev-aaaaaaaa", 0, "B"); assert(a.ok); assert.strictEqual(a.seconds, 5);
  assert.strictEqual(sub("Mohamed Adel", "dev-aaaaaaaa", 0, "C").error, "DUPLICATE");
  assert.strictEqual(sub("Mohamed Ahmed", "dev-wrongggg", 0, "C").error, "NOT_JOINED");
  rt.advance(10000); assert.strictEqual(sub("Mohamed Ahmed", "dev-bbbbbbbb", 0, "B").seconds, 15);
  rt.advance(10000); assert.strictEqual(sub("Hossam Mohamed", "dev-cccccccc", 0, "A").seconds, 25);
  rt.advance(15000); assert.strictEqual(sub("أحمد علي", "dev-dddddddd", 0, "B").seconds, 40);
  const s = G({ action: "state", code }); assert.strictEqual(s.submittedCount, 4);
});

t("NO automatic correction: all answers pending with 0 points", () => {
  const subs = T({ action: "teacherState" }).submissions;
  assert(subs.every(x => x.status === "pending" && x.points === 0));
  assert.deepStrictEqual(G({ action: "state", code }).teams, { Blue: 0, Green: 0 });
});

const subOf = n => T({ action: "teacherState" }).submissions.find(x => x.name === n && x.qIndex === 0);
t("teacher marks correct -> speed points; team totals", () => {
  T({ action: "review", submissionId: subOf("Mohamed Adel").id, status: "correct" });     // 5s  -> 100 Blue
  T({ action: "review", submissionId: subOf("Mohamed Ahmed").id, status: "correct" });    // 15s -> 80 Green
  T({ action: "review", submissionId: subOf("Hossam Mohamed").id, status: "incorrect" }); // 0 Green
  T({ action: "review", submissionId: subOf("أحمد علي").id, status: "correct" });          // 40s -> 40 Blue
  assert.deepStrictEqual(G({ action: "state", code }).teams, { Blue: 140, Green: 80 });
});
t("marking correct twice does NOT double the points", () => {
  T({ action: "review", submissionId: subOf("Mohamed Adel").id, status: "correct" });
  T({ action: "review", submissionId: subOf("Mohamed Adel").id, status: "correct" });
  assert.strictEqual(G({ action: "state", code }).teams.Blue, 140);
});
t("undo and manual adjustment", () => {
  T({ action: "review", submissionId: subOf("أحمد علي").id, status: "pending" });
  assert.strictEqual(G({ action: "state", code }).teams.Blue, 100);
  T({ action: "adjust", submissionId: subOf("Hossam Mohamed").id, points: 30 });
  assert.strictEqual(G({ action: "state", code }).teams.Green, 110);
  assert.strictEqual(subOf("Hossam Mohamed").status, "adjusted");
});

t("points table boundaries 10/11/20/21/30/31/45/46/60", () => {
  const f = rt.sandbox.pointsFor_;
  assert.deepStrictEqual([0, 10, 11, 20, 21, 30, 31, 45, 46, 60, 61].map(f), [100, 100, 80, 80, 60, 60, 40, 40, 20, 20, 0]);
});

t("question closes after 60 s", () => {
  rt.advance(25000);   // now 70 s into Q1
  const r = P({ action: "join", code, studentId: id("سارة خالد"), deviceToken: "dev-eeeeeeee" }); assert(r.ok);
  assert(["Blue", "Green"].includes(r.student.team), "late joiner is placed in a team automatically");
  const gs = G({ action: "state", code }).players;
  assert(Math.abs(gs.filter(p => p.team === "Blue").length - gs.filter(p => p.team === "Green").length) <= 1);
  assert.strictEqual(sub("سارة خالد", "dev-eeeeeeee", 0, "A").error, "TIME_UP");
});

t("next question, pause freezes timer, resume continues", () => {
  T({ action: "control", cmd: "next" });
  rt.advance(8000);
  T({ action: "control", cmd: "pause" });
  assert.strictEqual(sub("سارة خالد", "dev-eeeeeeee", 1, "C").error, "PAUSED");
  rt.advance(60000);
  const s = G({ action: "state", code }); assert.strictEqual(s.status, "paused"); assert.strictEqual(Math.floor(s.qElapsedMs / 1000), 8);
  T({ action: "control", cmd: "resume" });
  rt.advance(3000);
  assert.strictEqual(sub("سارة خالد", "dev-eeeeeeee", 1, "C").seconds, 11);
  assert.strictEqual(sub("سارة خالد", "dev-eeeeeeee", 0, "A").error, "WRONG_QUESTION");
});
t("bulk review marks only pending answers", () => {
  sub("Mohamed Adel", "dev-aaaaaaaa", 1, "A");
  const r = T({ action: "bulkReview", qIndex: 1, answer: "C" });
  assert.strictEqual(r.changed, 2);
  const s = T({ action: "teacherState" }).submissions.filter(x => x.qIndex === 1);
  assert.strictEqual(s.find(x => x.name === "سارة خالد").points, 80);
  assert.strictEqual(s.find(x => x.name === "Mohamed Adel").points, 0);
});
t("previous question works", () => { T({ action: "control", cmd: "prev" }); assert.strictEqual(G({ action: "state", code }).qIndex, 0); T({ action: "control", cmd: "next" }); });

t("7-minute game clock closes answers", () => {
  T({ action: "control", cmd: "next" });   // Q3
  rt.advance(7 * 60000);
  const s = G({ action: "state", code }); assert(s.gameTimeUp); assert(!s.acceptingAnswers);
  assert.strictEqual(sub("Mohamed Adel", "dev-aaaaaaaa", 2, "A").error, "TIME_UP");
});

t("end game -> winner", () => {
  T({ action: "control", cmd: "end" });
  const s = G({ action: "state", code });
  assert.strictEqual(s.status, "ended"); assert.strictEqual(s.winner, s.teams.Blue > s.teams.Green ? "Blue" : "Green");
});
t("Scores and Teams sheets are written", () => {
  const teams = rt.sheet("Teams"); assert.strictEqual(teams[1][0], "Blue"); assert.strictEqual(teams[1][1], "NUMBER NINJAS"); assert.strictEqual(teams[2][1], "MATH TITANS");
  assert(rt.sheet("Scores").length > 2);
});
t("reset clears answers and points, keeps players", () => {
  T({ action: "control", cmd: "reset" });
  const s = G({ action: "state", code });
  assert.strictEqual(s.status, "lobby"); assert.deepStrictEqual(s.teams, { Blue: 0, Green: 0 }); assert.strictEqual(s.joinedCount, 5);
});
t("new room closes the old code", () => {
  const c2 = T({ action: "createRoom", name: "5B" }).room.code;
  assert.notStrictEqual(c2, code);
  assert.strictEqual(G({ action: "state", code }).error, "ROOM_CLOSED");
  assert(G({ action: "state", code: c2 }).ok);
});
t("release + remove student", () => {
  const c = T({ action: "teacherState" }).room.code;
  assert(P({ action: "join", code: c, studentId: id("Mohamed Adel"), deviceToken: "dev-aaaaaaaa" }).ok);
  T({ action: "releaseStudent", studentId: id("Mohamed Adel") });
  assert(P({ action: "join", code: c, studentId: id("Mohamed Adel"), deviceToken: "dev-newdevic" }).ok);
  const mid = id("Mahmoud Hassan");
  T({ action: "removeStudent", studentId: mid });
  assert.strictEqual(P({ action: "join", code: c, studentId: mid, deviceToken: "dev-zzzzzzzz" }).error, "NOT_IN_LIST");
});
t("classes: separate lists, room limited to its class", () => {
  T({ action: "uploadStudents", mode: "replace", className: "Class 1", students: [{ name: "Omar Emad", team: "" }, { name: "Kenan Ameen", team: "" }, { name: "Anas Jamal", team: "" }] });
  T({ action: "uploadStudents", mode: "replace", className: "Class 2", students: [{ name: "Omar Obada", team: "" }, { name: "Yazan Alhabian", team: "" }] });
  let ts = T({ action: "teacherState" });
  assert.deepStrictEqual(ts.classes.map(c => c.name + ":" + c.count), ["Class 1:3", "Class 2:2"]);
  // replacing Class 2 does not touch Class 1
  T({ action: "uploadStudents", mode: "replace", className: "Class 2", students: [{ name: "Omar Obada", team: "Green" }, { name: "Yazan Alhabian", team: "Blue" }, { name: "Rayan Rafat", team: "Blue" }] });
  ts = T({ action: "teacherState" });
  assert.strictEqual(ts.students.filter(s => s.className === "Class 1").length, 3);
  assert.strictEqual(ts.students.filter(s => s.className === "Class 2").length, 3);
  // same name allowed in a different class, duplicate inside the class skipped
  const d = T({ action: "uploadStudents", mode: "append", className: "Class 2", students: [{ name: "omar obada" }] });
  assert.strictEqual(d.added, 0);
  const room = T({ action: "createRoom", name: "2nd", className: "Class 2" }).room;
  assert.strictEqual(room.className, "Class 2");
  const r = P({ action: "roster", code: room.code });
  assert.deepStrictEqual(r.students.map(s => s.name).sort(), ["Omar Obada", "Rayan Rafat", "Yazan Alhabian"]);
  const c1id = ts.students.find(s => s.name === "Omar Emad").id;
  assert.strictEqual(P({ action: "join", code: room.code, studentId: c1id, deviceToken: "dev-class1xx" }).error, "NOT_IN_LIST");
  const c2id = ts.students.find(s => s.name === "Omar Obada").id;
  assert(P({ action: "join", code: room.code, studentId: c2id, deviceToken: "dev-class2xx" }).ok);
  assert.strictEqual(T({ action: "removeClass", className: "Class 1" }).removed, 3);
  assert.deepStrictEqual(T({ action: "teacherState" }).classes.map(c => c.name), ["Class 2"]);
});
t("old sheets get the new className column added", () => {
  const data = rt.sheet("Students"); assert.strictEqual(data[0][5], "className");
  assert.strictEqual(rt.sheet("Rooms")[0][5], "className");
});
t("automatic marking: points given instantly from the answer key", () => {
  const c = T({ action: "createRoom", name: "auto-mark", className: "Class 2" }).room.code;
  T({ action: "setAutoMark", on: true });
  const ss = T({ action: "teacherState" }).students.filter(s => s.className === "Class 2");
  ss.forEach((s, i) => assert(P({ action: "join", code: c, studentId: s.id, deviceToken: "dev-am00000" + i }).ok));
  T({ action: "divideTeams" });
  T({ action: "control", cmd: "start" });
  rt.advance(4000);
  const right = P({ action: "submit", code: c, studentId: ss[0].id, deviceToken: "dev-am000000", qIndex: 0, answer: "B" });   // key B
  rt.advance(10000);
  const wrong = P({ action: "submit", code: c, studentId: ss[1].id, deviceToken: "dev-am000001", qIndex: 0, answer: "A" });
  assert(right.ok && wrong.ok);
  const subs = T({ action: "teacherState" }).submissions;
  const r = subs.find(x => x.studentId === ss[0].id), w = subs.find(x => x.studentId === ss[1].id);
  assert.strictEqual(r.status, "correct"); assert.strictEqual(r.points, 100);
  assert.strictEqual(w.status, "incorrect"); assert.strictEqual(w.points, 0);
  const pl = G({ action: "state", code: c });
  assert.strictEqual(pl.teams[pl.players.find(p => p.id === ss[0].id).team] >= 100, true);
  // teacher can still override
  T({ action: "review", submissionId: w.id, status: "correct" });
  assert.strictEqual(T({ action: "teacherState" }).submissions.find(x => x.id === w.id).points, 80);
  // switching OFF leaves new answers pending; switching ON scores them
  T({ action: "setAutoMark", on: false });
  P({ action: "submit", code: c, studentId: ss[2].id, deviceToken: "dev-am000002", qIndex: 0, answer: "B" });
  assert.strictEqual(T({ action: "teacherState" }).submissions.find(x => x.studentId === ss[2].id).status, "pending");
  assert.strictEqual(T({ action: "setAutoMark", on: true }).changed, 1);
  assert.strictEqual(T({ action: "teacherState" }).submissions.find(x => x.studentId === ss[2].id).status, "correct");
  T({ action: "setAutoMark", on: false });
});

t("Start without dividing first: everyone still gets a team", () => {
  const c = T({ action: "createRoom", name: "auto", className: "Class 2" }).room.code;
  const ts = T({ action: "teacherState" }).students.filter(s => s.className === "Class 2");
  ts.forEach((s, i) => assert(P({ action: "join", code: c, studentId: s.id, deviceToken: "dev-auto000" + i }).ok));
  assert(G({ action: "state", code: c }).players.every(p => p.team === ""));
  T({ action: "control", cmd: "start" });
  const pl = G({ action: "state", code: c }).players;
  assert(pl.every(p => p.team === "Blue" || p.team === "Green"));
  assert(Math.abs(pl.filter(p => p.team === "Blue").length - pl.filter(p => p.team === "Green").length) <= 1);
  assert.strictEqual(T({ action: "divideTeams" }).changed, 0, "teams are not reshuffled once the game has started");
  // moving a student to the other team mid-game moves their points too
  const me = pl[0], other = me.team === "Blue" ? "Green" : "Blue";
  rt.advance(3000);
  P({ action: "submit", code: c, studentId: me.id, deviceToken: "dev-auto0000", qIndex: 0, answer: "B" });
  const sub = T({ action: "teacherState" }).submissions.find(x => x.studentId === me.id);
  T({ action: "review", submissionId: sub.id, status: "correct" });
  assert.strictEqual(G({ action: "state", code: c }).teams[me.team], 100);
  T({ action: "setTeam", studentId: me.id, team: other });
  const t2 = G({ action: "state", code: c }).teams;
  assert.strictEqual(t2[other], 100); assert.strictEqual(t2[me.team], 0);
});
t("logout invalidates the token", () => { T({ action: "logout" }); assert.strictEqual(T({ action: "teacherState" }).error, "AUTH"); });

console.log("\n" + passed + " backend tests passed");
