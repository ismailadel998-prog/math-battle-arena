/* MATH BATTLE ARENA — student screen */
(function () {
  const $ = id => document.getElementById(id);
  const LS = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } }
  };

  // A random id for this device: stops one device joining as several names,
  // and lets a refreshed page re-join automatically.
  let device = LS.get("mba_device", null);
  if (!device) {
    device = "D" + Array.from(crypto.getRandomValues(new Uint8Array(12))).map(b => b.toString(16).padStart(2, "0")).join("");
    LS.set("mba_device", device);
  }

  let session = LS.get("mba_session", null);   // {code, id, name, team}
  let roster = [];
  let chosen = null;
  let state = null, stateAt = 0;
  let currentQ = null;
  let sending = false;
  let celebrated = false;

  const poll = MBA.poller(refresh, 2500);
  $("qRing").innerHTML = MBA.ringHTML();

  /* ---------------- join screen ---------------- */
  const params = new URLSearchParams(location.search);
  const urlRoom = (params.get("room") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);

  $("code").addEventListener("input", e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
    chosen = null; renderChosen();
    if (e.target.value.length === 5) loadRoster(e.target.value);
    else { $("nameStep").hidden = true; msg(""); }
  });

  async function loadRoster(code) {
    msg("Checking room…");
    try {
      const r = await MBA.apiGet("roster", { code });
      roster = r.students;
      $("nameStep").hidden = false;
      msg("Room found: " + (r.room.name || code), "ok");
      $("nameq").focus();
      renderSuggest();
    } catch (e) {
      $("nameStep").hidden = true;
      msg(e.message, "err");
    }
  }

  $("nameq").addEventListener("input", () => { chosen = null; renderChosen(); renderSuggest(); });

  function renderSuggest() {
    const q = $("nameq").value;
    const box = $("suggest");
    if (!q.trim()) { box.innerHTML = ""; return; }
    const hits = MBA.searchNames(roster, q);
    if (!hits.length) {
      box.innerHTML = '<div class="muted center" style="padding:8px">No first name starts with “' + MBA.esc(q) + '”. Check the spelling or ask your teacher.</div>';
      return;
    }
    const nq = MBA.normName(q).length;
    box.innerHTML = hits.map(s => {
      const first = s.name.split(" ")[0];
      const rest = s.name.slice(first.length);
      const hl = '<mark>' + MBA.esc(first.slice(0, nq)) + '</mark>' + MBA.esc(first.slice(nq)) + MBA.esc(rest);
      const right = s.joined ? '<span class="muted">already joined</span>' : '<span class="muted">tap to choose</span>';
      return '<button type="button" class="sugg' + (s.joined ? ' taken' : '') + '" data-id="' + MBA.esc(s.id) + '" dir="auto"><span>' + hl + '</span>' + right + '</button>';
    }).join("");
  }

  $("suggest").addEventListener("click", e => {
    const b = e.target.closest(".sugg");
    if (!b) return;
    const s = roster.find(x => x.id === b.dataset.id);
    if (!s) return;
    if (s.joined) { msg("This name has already joined. If it is you, ask your teacher.", "err"); return; }
    chosen = s;
    $("nameq").value = s.name;
    $("suggest").innerHTML = "";
    renderChosen();
  });

  function renderChosen() {
    const box = $("selected");
    if (!chosen) { box.hidden = true; $("btnJoin").disabled = true; return; }
    box.className = "selected-name";
    box.innerHTML = MBA.esc(chosen.name) + '<br><span style="font-size:1rem">⚔️ Your team will be chosen after you join</span>';
    box.hidden = false;
    $("btnJoin").disabled = false;
    msg("");
  }

  $("btnJoin").addEventListener("click", async () => {
    if (!chosen) return;
    const code = $("code").value;
    $("btnJoin").disabled = true;
    msg("Joining…");
    try {
      const r = await MBA.apiPost("join", { code, studentId: chosen.id, deviceToken: device });
      session = { code, id: r.student.id, name: r.student.name, team: r.student.team };
      LS.set("mba_session", session);
      enterGame();
    } catch (e) {
      msg(e.message, "err");
      $("btnJoin").disabled = false;
      if (e.code === "ALREADY_JOINED") loadRoster(code);
    }
  });

  function msg(t, kind) { const m = $("joinMsg"); m.textContent = t; m.className = "msg center " + (kind || ""); }

  /* ---------------- game ---------------- */
  function enterGame() {
    const t = MBA.TEAM[session.team];
    $("lobbyCard").className = "card lobby-card " + (t ? t.cls : "");
    $("lobbyMascot").hidden = !t; $("lobbyVs").hidden = !!t;
    if (t) $("lobbyMascot").src = t.img;
    $("lobbyName").textContent = "Welcome, " + session.name + "!";
    $("lobbyTeam").textContent = t ? t.emoji + " " + t.label + " – " + t.name : "⚔️ Teams are chosen soon…";
    $("lobbyWait").textContent = t ? "Waiting for your teacher to start" : "Waiting for your teacher to divide the teams";
    $("lobbyRoom").textContent = "Room " + session.code;
    $("hudMe").className = "me " + (t ? t.cls : "");
    $("hudImg").src = t ? t.img : "assets/img/favicon.svg";
    $("hudName").textContent = session.name;
    if (!state) show("scr-lobby");
    poll.start();
  }

  // A student is only sent back to the join screen when the problem is confirmed by
  // several polls in a row (about 8 seconds). One glitchy reply never kicks anyone out.
  const STRIKES_TO_LEAVE = 3;
  let closedStrikes = 0, missingStrikes = 0;

  async function refresh() {
    const sent = Date.now();
    let s;
    try {
      s = await MBA.apiGet("state", { code: session.code });
    } catch (e) {
      if (e.code === "ROOM_CLOSED") {
        if (++closedStrikes >= STRIKES_TO_LEAVE) leave("Your teacher closed this room. Enter the new room code.");
        return;
      }
      throw e;
    }
    closedStrikes = 0;
    if (!s.players.some(p => p.id === session.id)) {
      if (++missingStrikes >= STRIKES_TO_LEAVE) leave("Your name was released by the teacher. Please join again.");
      return;                     // keep showing the last good screen meanwhile
    }
    missingStrikes = 0;
    MBA.clock.sync(s.serverNow, sent);
    state = s; stateAt = Date.now();
    render();
  }

  function leave(text) {
    poll.stop();
    ["msBlue", "msGreen"].forEach(id => { $(id).dataset.v = 0; $(id).textContent = "0"; });   // no old scores in the next room
    closedStrikes = 0; missingStrikes = 0;
    LS.del("mba_session");
    session = null; state = null; currentQ = null;
    $("overlay").hidden = true;
    show("scr-join");
    $("code").value = ""; $("nameStep").hidden = true; chosen = null; renderChosen();
    msg(text || "", "err");
  }

  function ansKey() { return "mba_answers_" + session.code + "_" + session.id + "_" + ((state && state.gameId) || ""); }
  function myAnswers() { return LS.get(ansKey(), {}); }
  function saveMyAnswer(q, a) { const m = myAnswers(); m[q] = a; LS.set(ansKey(), m); }

  function render() {
    const s = state;
    if (!s) return;
    const me = s.players.find(p => p.id === session.id);
    if (!me) return;
    if (me.team !== session.team) {
      const firstReveal = !session.team && me.team;
      session.team = me.team; LS.set("mba_session", session); enterGame();
      if (firstReveal) revealTeam(me.team);
    }
    $("hudPts").textContent = me.score + " pts";
    MBA.animateNumber($("msBlue"), s.teams.Blue);
    MBA.animateNumber($("msGreen"), s.teams.Green);
    $("lobbyCount").textContent = s.joinedCount + " players in the arena";

    if (s.status === "lobby") {
      currentQ = null; celebrated = false;
      $("overlay").hidden = true;
      show("scr-lobby");
      return;
    }
    if (s.status === "ended") {
      $("overlay").hidden = true;
      showEnd(me);
      return;
    }
    // running or paused
    show("scr-question");
    if (s.question && currentQ !== s.qIndex) buildQuestion(s);
    updateLock();
    if (s.status === "paused") overlay("PAUSED ⏸", "Wait for your teacher…");
    else if (s.gameTimeUp) overlay("TIME'S UP! ⏰", "Waiting for your teacher…");
    else $("overlay").hidden = true;
  }

  function buildQuestion(s) {
    currentQ = s.qIndex;
    $("qCount").textContent = "Q" + (s.qIndex + 1) + "/" + s.qCount;
    $("qNum").textContent = s.qIndex + 1;
    $("qText").textContent = s.question.text;
    const box = $("answers");
    box.className = "answers";
    box.innerHTML = s.question.options.map((o, i) => {
      const L = "ABCD"[i];
      return '<button class="ans" data-l="' + L + '"><span class="letter">' + L + '</span><span dir="auto">' + MBA.esc(o) + '</span></button>';
    }).join("");
    box.querySelectorAll(".ans").forEach(b => b.addEventListener("click", () => submit(b.dataset.l)));
  }

  function updateLock() {
    const s = state;
    const mine = myAnswers()[s.qIndex];
    const done = s.submittedIds.includes(session.id) || !!mine;
    const box = $("answers");
    const closed = !s.acceptingAnswers && s.status === "running";
    if (done) {
      box.classList.add("locked");
      box.querySelectorAll(".ans").forEach(b => { b.disabled = true; b.classList.toggle("picked", b.dataset.l === mine); });
      $("qStatus").innerHTML = "✅ Answer locked" + (mine ? ": <b>" + mine + "</b>" : "") + (s.autoMark ? " — wait for the next question!" : " — your teacher will check it!");
    } else if (closed || sending) {
      box.classList.add("locked");
      box.querySelectorAll(".ans").forEach(b => b.disabled = true);
      if (!sending) $("qStatus").textContent = "⏰ Time's up for this question!";
    } else {
      box.classList.remove("locked");
      box.querySelectorAll(".ans").forEach(b => b.disabled = false);
      $("qStatus").textContent = "Tap your answer — you get ONE try!";
    }
  }

  async function submit(letter) {
    if (sending || !state) return;
    const q = state.qIndex;
    if (myAnswers()[q]) return;
    sending = true;
    const box = $("answers");
    box.classList.add("locked");
    box.querySelectorAll(".ans").forEach(b => { b.disabled = true; b.classList.toggle("picked", b.dataset.l === letter); });
    $("qStatus").textContent = "Sending…";
    try {
      const r = await MBA.apiPost("submit", { code: session.code, studentId: session.id, deviceToken: device, qIndex: q, answer: letter });
      saveMyAnswer(q, r.answer);
      if (state && !state.submittedIds.includes(session.id)) state.submittedIds.push(session.id);
    } catch (e) {
      if (e.code === "DUPLICATE") {
        const m = /\(([ABCD])\)/.exec(e.message);
        if (m) saveMyAnswer(q, m[1]);
        MBA.toast("You already answered this question.");
      } else {
        MBA.toast(e.message, true);
      }
    } finally {
      sending = false;
      if (state) updateLock();
      poll.now();
    }
  }

  function revealTeam(team) {
    const t = MBA.TEAM[team]; if (!t) return;
    const card = $("lobbyCard");
    card.classList.remove("reveal"); void card.offsetWidth; card.classList.add("reveal");
    MBA.confetti(team === "Blue" ? ["#2f8cff", "#8cc4ff", "#fff"] : ["#22d36f", "#8ff0b6", "#fff"], 2500);
    if (navigator.vibrate) try { navigator.vibrate(200); } catch (e) { }
  }

  function showEnd(me) {
    show("scr-end");
    const s = state;
    const w = s.winner;
    const t = MBA.TEAM[w];
    $("endCard").className = "card end-card " + (t ? t.cls : "");
    $("endMascot").src = t ? t.img : (MBA.TEAM[session.team] || MBA.TEAM.Blue).img;
    $("endTitle").textContent = t ? t.name + " WIN! 🏆" : "IT'S A TIE! 🤝";
    $("endBlue").textContent = s.teams.Blue;
    $("endGreen").textContent = s.teams.Green;
    $("endMine").textContent = me.score;
    if (!celebrated) {
      celebrated = true;
      MBA.confetti(w === "Blue" ? ["#2f8cff", "#8cc4ff", "#ffcc33", "#fff"] : w === "Green" ? ["#22d36f", "#8ff0b6", "#ffcc33", "#fff"] : ["#2f8cff", "#22d36f", "#ffcc33"]);
    }
  }

  function overlay(text, sub) { $("ovText").textContent = text; $("ovSub").textContent = sub || ""; $("overlay").hidden = false; }

  function show(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === id));
  }

  /* ---------------- smooth countdown between polls ---------------- */
  setInterval(() => {
    const s = state;
    if (!s || (s.status !== "running" && s.status !== "paused")) return;
    const drift = s.status === "running" ? Date.now() - stateAt : 0;
    const qLeft = s.qSeconds * 1000 - (s.qElapsedMs + drift);          // visible countdown
    const totalLeft = qLeft + (s.bonusSeconds || 0) * 1000;           // + hidden bonus
    const gLeft = s.gameSeconds * 1000 - (s.gameElapsedMs + drift);
    MBA.setRing($("qRing"), Math.min(qLeft, gLeft), s.qSeconds * 1000);
    const inBonus = qLeft <= 0 && totalLeft > 0 && gLeft > 0 && s.acceptingAnswers;
    if (inBonus) {                                                    // no numbers during the hidden bonus
      const ring = $("qRing"); ring.classList.remove("warn"); ring.querySelector(".num").textContent = "⏳";
      if (!$("answers").classList.contains("locked")) $("qStatus").textContent = "⚡ Last chance — answer now!";
    }
    $("gClock").textContent = "Game " + MBA.fmtClock(gLeft);
    if (s.status === "running" && s.acceptingAnswers && (totalLeft <= 0 || gLeft <= 0)) {
      s.acceptingAnswers = false;
      if (gLeft <= 0) s.gameTimeUp = true;
      render();
    }
  }, 250);

  /* ---------------- start ---------------- */
  if (!MBA.configured()) {
    msg("The game server is not set up yet. (Teacher: edit assets/js/config.js)", "err");
  } else if (session && session.code && (!urlRoom || urlRoom === session.code)) {
    // Refresh / come back: re-join silently with the same device id.
    MBA.apiPost("join", { code: session.code, studentId: session.id, deviceToken: device })
      .then(r => { session.team = r.student.team; LS.set("mba_session", session); enterGame(); })
      .catch(e => {
        if (e.code === "BAD_RESPONSE" || e.code === "NOT_CONFIGURED" || !e.code || e.code === "ERROR") { enterGame(); return; }
        leave(e.message);
        if (urlRoom) { $("code").value = urlRoom; loadRoster(urlRoom); }
      });
  } else if (urlRoom) {
    $("code").value = urlRoom;
    loadRoster(urlRoom);
  }
})();
