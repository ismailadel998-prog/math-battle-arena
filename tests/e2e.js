/* End-to-end test: teacher + arena + 4 students in separate browser contexts.
   Usage: node tests/server.js &  then  node tests/e2e.js */
const { chromium, devices } = require("playwright");
const assert = require("assert");
const WEB = "http://localhost:8080/", API = "http://localhost:8787";
const shot = (p, n) => p.screenshot({ path: __dirname + "/screens/" + n + ".png" });
let step = 0; const ok = m => console.log("  ✔ " + (++step) + ". " + m);
const advance = ms => fetch(API + "/__advance?ms=" + ms);

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
    const p = await ctx.newPage();
    p.on("pageerror", e => errors.push(e.message));
    p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    return p;
  };

  // ---------- teacher ----------
  const teacher = await mk({ viewport: { width: 1366, height: 900 } });
  await teacher.goto(WEB + "teacher.html");
  await teacher.waitForSelector("#login:not([hidden])");
  await teacher.fill("#pw", "wrong"); await teacher.click("#btnLogin");
  await teacher.waitForFunction(() => document.getElementById("loginMsg").textContent.includes("Wrong"));
  assert(await teacher.isHidden("#dash"));
  ok("wrong teacher password rejected by the server");
  await shot(teacher, "01-teacher-login");
  await teacher.fill("#pw", "Aa1234"); await teacher.click("#btnLogin");
  await teacher.waitForSelector("#dash:not([hidden])");
  ok("teacher logs in with Aa1234");
  const html = await (await fetch(WEB + "assets/js/teacher.js")).text() + await (await fetch(WEB + "assets/js/common.js")).text() + await (await fetch(WEB + "teacher.html")).text();
  assert(!html.includes("Aa1234"));
  ok("password does not appear anywhere in the website code");
  await teacher.waitForSelector("[data-automark].on");
  await teacher.locator("[data-automark]").first().click();
  await teacher.waitForFunction(() => [...document.querySelectorAll("[data-automark]")].every(b => !b.classList.contains("on")));
  ok("automatic marking is ON by default; teacher switches it OFF for manual review");

  // upload students via paste
  await teacher.click('[data-tab="students"]');
  // a second class that must NOT appear in the Class 1 room
  await teacher.fill("#upClass", "Class 2");
  await teacher.fill("#paste", "Omar Obada,Green\nMohanad Sami,Blue\nYazan Alhabian,Blue");
  await teacher.waitForFunction(() => document.getElementById("upPreview").textContent.includes("3 names"));
  await teacher.click("#btnUpload");
  await teacher.waitForFunction(() => document.getElementById("upMsg").textContent.includes("3 students added to Class 2"));
  await teacher.fill("#upClass", "Class 1");
  await teacher.fill("#paste", "Name,Team\nMohamed Adel,Blue\nMohamed Ahmed,Green\nHossam Mohamed,Green\nMahmoud Hassan,Blue\nأحمد علي,أزرق\nسارة خالد,أخضر\nMohamed Adel,Blue");
  await teacher.waitForFunction(() => document.getElementById("upPreview").textContent.includes("7 names"));
  await teacher.selectOption("#upMode", "replace");
  teacher.once("dialog", d => d.accept());
  await teacher.click("#btnUpload");
  await teacher.waitForFunction(() => document.getElementById("upMsg").textContent.includes("6 students added to Class 1"));
  ok("two classes uploaded: Class 1 (6 added, 1 duplicate skipped) and Class 2 (3)");
  await teacher.waitForFunction(() => document.querySelectorAll("#stuBody tr").length === 9);
  await teacher.selectOption("#stuClass", "Class 1");
  await teacher.waitForFunction(() => document.querySelectorAll("#stuBody tr").length === 6);
  ok("student list can be filtered by class");
  await shot(teacher, "02-teacher-students");

  // create room
  await teacher.click('[data-tab="game"]');
  await teacher.fill("#roomName", "Grade 5A Battle");
  await teacher.selectOption("#roomClass", "Class 1");
  await new Promise(r => setTimeout(r, 2500));
  const oldCode = await teacher.$eval("#roomInfo", el => (el.querySelector(".codebox") || {}).textContent || "");
  if (oldCode) teacher.once("dialog", d => d.accept());
  await teacher.click("#btnCreateRoom");
  await teacher.waitForFunction(o => { const c = document.querySelector("#roomInfo .codebox"); return c && c.textContent !== o; }, oldCode);
  const code = (await teacher.textContent("#roomInfo .codebox")).trim();
  assert(/^[A-Z]{5}$/.test(code));
  ok("room created with code " + code);

  // timer dropdowns: 1.5 min visible + 30 s hidden bonus -> game time grows to fit, points bands stretch over 2 min
  await teacher.selectOption("#qTime", "90");
  await new Promise(r => setTimeout(r, 1500));
  await teacher.selectOption("#bTime", "30");
  await teacher.waitForFunction(() => document.getElementById("gTime").value === "720" && document.getElementById("pointsHint").textContent.includes("0–20 s = 100") && document.getElementById("pointsHint").textContent.includes("students see 1:30"), null, { timeout: 15000 });
  await new Promise(r => setTimeout(r, 2500));
  const st120 = await (await fetch(API + "/exec?action=state&code=" + code)).json();
  assert.strictEqual(st120.qSeconds, 90); assert.strictEqual(st120.bonusSeconds, 30); assert.strictEqual(st120.gameSeconds, 720);
  ok("teacher sets 1:30 per question + 30 s hidden bonus: game time 12 min, points 0–20 s = 100 …");
  await teacher.selectOption("#qTime", "60");
  await new Promise(r => setTimeout(r, 1500));
  await teacher.selectOption("#bTime", "0");
  await new Promise(r => setTimeout(r, 1500));
  await teacher.selectOption("#gTime", "420");
  await teacher.waitForFunction(() => document.getElementById("pointsHint").textContent.includes("0–10 s = 100"));
  await new Promise(r => setTimeout(r, 2500));
  assert.strictEqual((await (await fetch(API + "/exec?action=state&code=" + code)).json()).qSeconds, 60);

  // ---------- arena ----------
  const arena = await mk({ viewport: { width: 1600, height: 900 } });
  await arena.goto(WEB + "arena.html?room=" + code);
  await arena.waitForFunction(c => document.getElementById("bigCode").textContent === c, code);
  ok("arena screen shows the room code");

  // ---------- students ----------
  const names = ["Mohamed Adel", "Mohamed Ahmed", "Hossam Mohamed", "أحمد علي"];
  const studs = [];
  for (let i = 0; i < 4; i++) studs.push(await mk(i === 0 ? { ...devices["iPhone 13"] } : {}));
  // student 0 types the room code by hand; others use the room link
  await studs[0].goto(WEB);
  await studs[0].fill("#code", code.toLowerCase());
  await studs[0].waitForSelector("#nameStep:not([hidden])");
  ok("student opens the site and enters the room code");
  await studs[0].fill("#nameq", "moh");
  await studs[0].waitForSelector(".sugg");
  const sugg = await studs[0].$$eval(".sugg > span:first-child", els => els.map(e => e.textContent));
  assert.deepStrictEqual(sugg.sort(), ["Mohamed Adel", "Mohamed Ahmed"]);
  ok('typing "moh" shows ONLY Mohamed Adel + Mohamed Ahmed (not Hossam Mohamed, not Mahmoud, not Class 2\'s Mohanad)');
  await studs[0].fill("#nameq", "Om");
  assert.strictEqual(await studs[0].$$eval(".sugg", e => e.length), 0);
  ok("Class 2 students (Omar Obada) are not offered in the Class 1 room");
  await studs[0].fill("#nameq", "M");
  const m1 = await studs[0].$$eval(".sugg > span:first-child", els => els.map(e => e.textContent));
  assert.deepStrictEqual(m1.sort(), ["Mahmoud Hassan", "Mohamed Adel", "Mohamed Ahmed"]);
  await studs[0].fill("#nameq", "Ho");
  assert.deepStrictEqual(await studs[0].$$eval(".sugg > span:first-child", els => els.map(e => e.textContent)), ["Hossam Mohamed"]);
  await studs[0].fill("#nameq", "xyz");
  assert.strictEqual(await studs[0].$$eval(".sugg", e => e.length), 0);
  assert(await studs[0].isDisabled("#btnJoin"));
  ok("1, 2 letters work; unknown names give no option and Join stays disabled");
  await studs[0].fill("#nameq", "moh");
  await shot(studs[0], "03-student-search-phone");

  for (let i = 1; i < 4; i++) {
    await studs[i].goto(WEB + "?room=" + code);
    await studs[i].waitForSelector("#nameStep:not([hidden])");
  }
  await studs[3].fill("#nameq", "احم");
  await studs[3].waitForSelector(".sugg");
  assert.deepStrictEqual(await studs[3].$$eval(".sugg > span:first-child", els => els.map(e => e.textContent)), ["أحمد علي"]);
  ok("Arabic search: احم finds أحمد علي (hamza-insensitive)");

  const pick = async (p, q, name) => {
    await p.fill("#nameq", q);
    await p.locator(".sugg", { hasText: name }).click();
    await p.waitForSelector("#selected:not([hidden])");
  };
  await pick(studs[0], "moh", "Mohamed Adel");
  await pick(studs[1], "Moham", "Mohamed Ahmed");
  await pick(studs[2], "hos", "Hossam Mohamed");
  await pick(studs[3], "احم", "أحمد علي");
  assert((await studs[0].textContent("#selected")).includes("chosen after you join"));
  ok("selecting a full name: no team yet, Join enabled");
  await Promise.all(studs.map(p => p.click("#btnJoin")));
  await Promise.all(studs.map(p => p.waitForSelector("#scr-lobby.active")));
  for (const p of studs) assert((await p.textContent("#lobbyTeam")).includes("Teams are chosen soon"));
  ok("4 students joined at the same time; all waiting for teams");
  await shot(studs[0], "04a-student-waiting-phone");

  // duplicate registration from another device
  const intruder = await mk();
  await intruder.goto(WEB + "?room=" + code);
  await intruder.waitForSelector("#nameStep:not([hidden])");
  await intruder.fill("#nameq", "moh");
  await intruder.waitForSelector(".sugg");
  assert.strictEqual(await intruder.locator(".sugg.taken").count(), 2);
  await intruder.locator(".sugg", { hasText: "Mohamed Adel" }).click();
  assert(await intruder.isDisabled("#btnJoin"));
  const forced = await (await fetch(API + "/exec", { method: "POST", body: JSON.stringify({ action: "join", code, studentId: "x", deviceToken: "intruder-device" }) })).json();
  assert.strictEqual(forced.ok, false);
  ok("a second device cannot join with an already-joined name or a made-up name");
  await intruder.context().close();

  await arena.waitForFunction(() => document.querySelectorAll("#rosterWait .chip").length === 4);
  await teacher.waitForFunction(() => document.querySelectorAll("#joinedList .chip").length === 4);
  ok("teacher dashboard + arena list the 4 joined students as waiting for teams");

  // ---------- divide into teams AFTER joining ----------
  await teacher.click("#btnDivide");
  await teacher.waitForFunction(() => /🔵 2\s+·\s+🟢 2/.test(document.getElementById("teamSplit").textContent));
  await arena.waitForFunction(() => document.querySelectorAll("#rosterBlue .chip").length === 2 && document.querySelectorAll("#rosterGreen .chip").length === 2);
  await Promise.all(studs.map(p => p.waitForFunction(() => /BLUE TEAM|GREEN TEAM/.test(document.getElementById("lobbyTeam").textContent))));
  ok("teacher presses Divide: 2 vs 2, every phone and the arena show the teams");
  await shot(studs[0], "04b-student-team-revealed-phone");
  await shot(arena, "05-arena-lobby");
  // arrange known teams by clicking names (tests moving a student)
  const want = { "Mohamed Adel": "Blue", "Mohamed Ahmed": "Green", "Hossam Mohamed": "Green", "أحمد علي": "Blue" };
  for (const [n, tm] of Object.entries(want)) {
    const st = await (await fetch(API + "/exec?action=state&code=" + code)).json();
    if (st.players.find(p => p.name === n).team !== tm) {
      await teacher.locator("#joinedList .chip", { hasText: n }).click();
      await teacher.waitForFunction(([n, cls]) => [...document.querySelectorAll("#joinedList .chip")].some(c => c.textContent.includes(n) && c.classList.contains(cls)), [n, tm === "Blue" ? "team-blue" : "team-green"]);
    }
  }
  const names4 = ["Mohamed Adel", "Mohamed Ahmed", "Hossam Mohamed", "أحمد علي"];
  for (let i = 0; i < 4; i++) await studs[i].waitForFunction(lbl => document.getElementById("lobbyTeam").textContent.includes(lbl), want[names4[i]] === "Blue" ? "NUMBER NINJAS" : "MATH TITANS");
  ok("clicking a name moves the student to the other team (phones update)");

  // ---------- start ----------
  await teacher.click('[data-cmd="start"]');
  await Promise.all(studs.map(p => p.waitForSelector("#scr-question.active")));
  const qtexts = await Promise.all(studs.map(p => p.textContent("#qText")));
  assert(qtexts.every(q => q === qtexts[0] && q.includes("1,326 cans")));
  await arena.waitForFunction(t => document.getElementById("aQtext").textContent === t, qtexts[0]);
  ok("all students + arena see the same question 1");

  await studs[0].click('.ans[data-l="B"]');                                   // ~0-2 s  -> 100
  await studs[0].waitForFunction(() => document.getElementById("qStatus").textContent.includes("locked"));
  await advance(12000); await studs[1].click('.ans[data-l="B"]');            // ~12-14s -> 80
  await advance(10000); await studs[2].click('.ans[data-l="A"]');            // ~22-24s -> 60 if correct (it is wrong)
  await advance(12000); await studs[3].click('.ans[data-l="B"]');            // ~34-36s -> 40
  for (const p of studs) await p.waitForFunction(() => document.getElementById("qStatus").textContent.includes("locked"));
  ok("every student submitted one answer");
  assert(await studs[0].isDisabled('.ans[data-l="C"]'));
  await studs[0].click('.ans[data-l="C"]', { force: true }).catch(() => { });
  await shot(studs[0], "06-student-answered-phone");

  // refresh keeps progress
  await studs[0].reload();
  await studs[0].waitForSelector("#scr-question.active");
  await studs[0].waitForFunction(() => document.getElementById("qStatus").textContent.includes("locked: B"));
  ok("refreshing the page keeps the student in the game with the answer locked");

  await arena.waitForFunction(() => document.getElementById("ansTxt").textContent.startsWith("4 / 4"));
  await shot(arena, "07-arena-question");
  ok("arena shows 4 / 4 answered");

  // ---------- review ----------
  await teacher.click('[data-tab="review"]');
  await teacher.waitForFunction(() => document.querySelectorAll("#reviewBody tr[data-id]").length === 4);
  const subs = [null, ...(await (await fetch(API + "/__sheet?name=Submissions")).json()).slice(1).filter(r => r[1] === code)];
  const secs = Object.fromEntries(subs.slice(1).map(r => [r[4], r[7]]));
  console.log("     recorded seconds:", JSON.stringify(secs));
  assert(subs.slice(1).every(r => r[8] === "pending" && r[9] === 0));
  ok("submissions saved in the Submissions sheet as pending with 0 points (no auto-correction)");
  await shot(teacher, "08-teacher-review-before");

  const mark = async (name, act) => {
    await teacher.locator("#reviewBody tr", { hasText: name }).locator('[data-act="' + act + '"]').click();
  };
  await mark("Mohamed Adel", "correct");
  await mark("Mohamed Ahmed", "correct");
  await mark("Hossam Mohamed", "incorrect");
  await mark("أحمد علي", "correct");
  const expected = n => { const s = secs[n]; return s <= 10 ? 100 : s <= 20 ? 80 : s <= 30 ? 60 : s <= 45 ? 40 : s <= 60 ? 20 : 0; };
  const blue = expected("Mohamed Adel") + expected("أحمد علي"), green = expected("Mohamed Ahmed");
  await teacher.waitForFunction(([b, g]) => document.getElementById("lsBlue").textContent == b && document.getElementById("lsGreen").textContent == g, [blue, green], { timeout: 15000 });
  ok("teacher marks answers; speed points correct (Blue " + blue + ", Green " + green + ")");
  // mark again -> no double points
  await mark("Mohamed Adel", "correct");
  await new Promise(r => setTimeout(r, 2500));
  assert.strictEqual(Number(await teacher.textContent("#lsBlue")), blue);
  ok("marking the same answer correct again does not add points twice");

  await Promise.all([...studs, arena].map(p => p.waitForFunction(([b, g]) => {
    const pick = id => document.getElementById(id); const bb = pick("msBlue") || pick("sBlue"), gg = pick("msGreen") || pick("sGreen");
    return bb.textContent == b && gg.textContent == g;
  }, [blue, green], { timeout: 15000 })));
  assert((await studs[0].textContent("#hudPts")).startsWith(String(expected("Mohamed Adel"))));
  ok("team scores updated on every student device and the arena");

  // undo + adjust
  await mark("Hossam Mohamed", "pending");
  await teacher.locator("#reviewBody tr", { hasText: "Hossam Mohamed" }).locator("input").fill("25");
  await mark("Hossam Mohamed", "adjust");
  await teacher.waitForFunction(g => document.getElementById("lsGreen").textContent == g, green + 25, { timeout: 15000 });
  ok("undo + manual score adjustment work");
  await shot(teacher, "09-teacher-review-after");

  // pause / resume / next / prev
  await teacher.click('[data-cmd="pause"]');
  await studs[1].waitForSelector("#overlay:not([hidden])");
  await arena.waitForSelector("#overlay:not([hidden])");
  ok("pause shows PAUSED on student + arena screens");
  await teacher.click('[data-cmd="resume"]');
  await studs[1].waitForSelector("#overlay", { state: "hidden" });
  await teacher.click('[data-cmd="next"]');
  await Promise.all(studs.map(p => p.waitForFunction(() => document.getElementById("qText").textContent.includes("Layla"))));
  assert(!(await studs[0].isDisabled('.ans[data-l="A"]')));
  ok("next question reaches everyone, answers unlocked again");
  await teacher.click('[data-tab="game"]');
  await teacher.click('[data-cmd="prev"]');
  await studs[2].waitForFunction(() => document.getElementById("qText").textContent.includes("1,326"));
  assert(await studs[2].isDisabled('.ans[data-l="C"]'));
  ok("previous question: students who already answered stay locked");
  await teacher.click('[data-cmd="next"]');
  await studs[2].waitForFunction(() => document.getElementById("qText").textContent.includes("Layla"));

  // brief glitches must not kick anyone out
  for (const mode of ["closed", "missing"]) {
    await fetch(API + "/__glitch?mode=" + mode + "&n=6");          // ~2 bad replies per student
    await new Promise(r => setTimeout(r, 7000));
    for (const p of studs) assert(await p.isVisible("#scr-question.active"), "student was kicked by a '" + mode + "' glitch");
  }
  ok("short server glitches (room closed / player missing) do not kick students out");

  // dashboard protection
  const outsider = await mk();
  await outsider.goto(WEB + "teacher.html");
  await outsider.waitForSelector("#login:not([hidden])");
  assert(await outsider.isHidden("#dash"));
  const hack = await (await fetch(API + "/exec", { method: "POST", body: JSON.stringify({ action: "control", cmd: "end" }) })).json();
  assert.strictEqual(hack.error, "AUTH");
  const hack2 = await (await fetch(API + "/exec", { method: "POST", body: JSON.stringify({ action: "control", cmd: "end", token: "guess" }) })).json();
  assert.strictEqual(hack2.error, "AUTH");
  ok("teacher dashboard + controls are protected (no token / fake token rejected)");
  await outsider.context().close();

  // teacher refresh keeps session + game
  await teacher.reload();
  await teacher.waitForSelector("#dash:not([hidden])");
  await teacher.waitForFunction(() => document.getElementById("gcQ").textContent.startsWith("2/"));
  ok("teacher page refresh keeps login and game progress");

  // automatic marking ON -> answer scored instantly
  await teacher.click('[data-tab="review"]');
  await teacher.locator("#tab-review [data-automark]").click();
  await teacher.waitForFunction(() => document.querySelector("#tab-review [data-automark]").classList.contains("on"));
  const before = Number(await teacher.textContent("#lsBlue"));
  await studs[0].click('.ans[data-l="C"]');   // Q2 answer key is C
  await teacher.waitForFunction(() => [...document.querySelectorAll("#reviewBody tr")].some(r => r.textContent.includes("Mohamed Adel") && r.classList.contains("correct")), null, { timeout: 15000 });
  const row = teacher.locator("#reviewBody tr", { hasText: "Mohamed Adel" });
  const secsQ2 = parseInt(await row.locator("td").nth(3).textContent());
  const ptsQ2 = Number(await row.locator("td").nth(5).textContent());
  const exp2 = secsQ2 <= 10 ? 100 : secsQ2 <= 20 ? 80 : secsQ2 <= 30 ? 60 : secsQ2 <= 45 ? 40 : 20;
  assert.strictEqual(ptsQ2, exp2);
  await teacher.waitForFunction(v => Number(document.getElementById("lsBlue").textContent) === v, before + exp2, { timeout: 15000 });
  await studs[0].waitForFunction(() => document.getElementById("qStatus").textContent.includes("wait for the next question"));
  ok("automatic marking ON: correct answer scored instantly (" + secsQ2 + " s = " + exp2 + " pts), team total updated");
  await shot(teacher, "09b-teacher-automark");
  const finalBlue = Number(await teacher.textContent("#lsBlue")), finalGreen = Number(await teacher.textContent("#lsGreen"));

  // end
  await teacher.click('[data-tab="game"]');
  teacher.once("dialog", d => d.accept());
  await teacher.click('[data-cmd="end"]');
  await Promise.all(studs.map(p => p.waitForSelector("#scr-end.active")));
  await arena.waitForSelector("#stEnd:not([hidden])");
  const win = finalBlue > finalGreen ? "NUMBER NINJAS" : "MATH TITANS";
  assert((await arena.textContent("#winTitle")).includes(win));
  ok("end game: winner celebration (" + win + ") on arena + students");
  await new Promise(r => setTimeout(r, 1200));
  await shot(arena, "10-arena-winner");
  await shot(studs[1], "11-student-end");

  // ---------- hidden bonus in a real game ----------
  teacher.once("dialog", d => d.accept());
  await teacher.click('[data-cmd="reset"]');
  await teacher.waitForFunction(() => !document.getElementById("qTime").disabled);
  await teacher.selectOption("#qTime", "90"); await new Promise(r => setTimeout(r, 1500));
  await teacher.selectOption("#bTime", "30"); await new Promise(r => setTimeout(r, 2500));
  await teacher.click('[data-cmd="start"]');
  await studs[3].waitForSelector("#scr-question.active");
  await studs[3].waitForFunction(() => document.querySelector("#qRing .num").textContent === "1:30" || document.querySelector("#qRing .num").textContent === "1:29");
  await advance(95000);                                   // 95 s: visible countdown over, bonus running
  await studs[3].waitForFunction(() => document.querySelector("#qRing .num").textContent === "⏳", null, { timeout: 15000 });
  await arena.waitForFunction(() => document.querySelector("#aRing .num").textContent === "⏳", null, { timeout: 15000 });
  assert(!(await studs[3].isDisabled('.ans[data-l="B"]')), "answers still open during the bonus");
  assert((await studs[3].textContent("#qStatus")).includes("Last chance"));
  await teacher.waitForFunction(() => document.getElementById("gcQT").textContent.includes("🎁"), null, { timeout: 15000 });
  await shot(studs[3], "12-student-hidden-bonus-phone");
  await studs[3].click('.ans[data-l="B"]');
  await studs[3].waitForFunction(() => document.getElementById("qStatus").textContent.includes("locked"));
  ok("hidden bonus: students see 1:30 then ⏳ (no numbers), can still answer; teacher sees 🎁 bonus countdown");
  await advance(30000);                                   // 125 s: closed
  await studs[0].waitForFunction(() => document.getElementById("qStatus").textContent.includes("Time's up"), null, { timeout: 15000 });
  ok("after the hidden 30 s, answers close");

  assert.deepStrictEqual(errors.filter(e => !/fonts\.g|Failed to load resource/.test(e)), []);
  ok("no JavaScript errors in any page");
  await browser.close();
  console.log("\nE2E: all " + step + " checks passed");
})().catch(e => { console.error("\n✘ FAILED:", e); process.exit(1); });
