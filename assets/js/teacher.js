/* MATH BATTLE ARENA — teacher dashboard */
(function () {
  const $ = id => document.getElementById(id);
  const esc = MBA.esc;
  const SS = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { } }
  };

  let token = SS.get("mba_teacher");
  let T = null, TAt = 0;            // latest teacher state
  let reviewQ = null;              // question selected in review tab (null = follow live question)
  let pendingRows = null;          // parsed upload rows
  const poll = MBA.poller(refresh, 2000);

  /* ---------------- auth ---------------- */
  function showLogin(msg) {
    poll.stop();
    $("dash").hidden = true; $("login").hidden = false;
    $("loginMsg").textContent = msg || "";
    $("pw").value = ""; $("pw").focus();
  }
  function showDash() { $("login").hidden = true; $("dash").hidden = false; poll.start(); }

  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("btnLogin").disabled = true; $("loginMsg").textContent = "";
    try {
      const r = await MBA.apiPost("login", { password: $("pw").value });
      token = r.token; SS.set("mba_teacher", token);
      showDash();
    } catch (err) { $("loginMsg").textContent = err.message; }
    finally { $("btnLogin").disabled = false; }
  });

  $("btnLogout").addEventListener("click", async () => {
    try { await MBA.apiPost("logout", { token }); } catch (e) { }
    token = null; SS.del("mba_teacher"); T = null;
    showLogin("Logged out.");
  });

  async function call(action, data = {}, okMsg) {
    try {
      const r = await MBA.apiPost(action, { token, ...data });
      if (okMsg) MBA.toast(okMsg);
      poll.now();
      return r;
    } catch (e) {
      if (e.code === "AUTH") { SS.del("mba_teacher"); showLogin("Your session expired. Please log in again."); }
      else MBA.toast(e.message, true);
      throw e;
    }
  }

  async function refresh() {
    try {
      T = await MBA.apiPost("teacherState", { token });
      TAt = Date.now();
      render();
    } catch (e) {
      if (e.code === "AUTH") { SS.del("mba_teacher"); showLogin("Please log in."); return; }
      throw e;
    }
  }

  /* ---------------- tabs ---------------- */
  $("tabs").addEventListener("click", e => {
    const b = e.target.closest(".tab"); if (!b) return;
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === b));
    document.querySelectorAll(".tabpane").forEach(p => p.hidden = p.id !== "tab-" + b.dataset.tab);
  });

  /* ---------------- helpers ---------------- */
  const teamChip = t => MBA.TEAM[t] ? '<span class="chip ' + MBA.TEAM[t].cls + '"><span class="dot"></span>' + (t === "Blue" ? "Blue" : "Green") + '</span>' : '<span class="chip">No team</span>';
  const studentLink = code => new URL("./", location.href).href + "?room=" + encodeURIComponent(code);
  const arenaLink = code => new URL("arena.html", location.href).href + (code ? "?room=" + encodeURIComponent(code) : "");

  /* ---------------- render ---------------- */
  function render() {
    if (!T) return;
    const st = T.settings, room = T.room;
    $("tbStatus").textContent = room ? st.status : "no room";
    $("tbStatus").className = "status-pill " + st.status;
    $("tbRoom").textContent = room ? "Room " + room.code : "";
    $("tbArena").href = arenaLink(room && room.code);
    renderRoom(); renderControl(); renderCurQ(); renderReview(); renderStudents(); renderBoard();
    MBA.animateNumber($("lsBlue"), T.teams.Blue);
    MBA.animateNumber($("lsGreen"), T.teams.Green);
    const pending = T.submissions.filter(s => s.status === "pending").length;
    $("pendingBadge").hidden = !pending; $("pendingBadge").textContent = pending;
  }

  function renderRoom() {
    const room = T.room;
    const box = $("roomInfo");
    if (!room) { box.innerHTML = '<p class="muted">No room yet. Give it a name and press <b>Create new room</b>.</p>'; }
    else {
      const sig = room.code;
      if (box.dataset.sig !== sig) {
        box.dataset.sig = sig;
        box.innerHTML =
          '<div class="eyebrow">' + esc(room.name) + '</div><div class="codebox">' + esc(room.code) + '</div>' +
          '<div class="row" style="margin-top:8px"><input class="input" style="flex:1;font-size:.9rem" readonly id="roomLink" value="' + esc(studentLink(room.code)) + '">' +
          '<button class="btn btn-sm btn-blue" id="btnCopy">📋 Copy room link</button>' +
          '<a class="btn btn-sm btn-ghost" target="_blank" rel="noopener" href="' + esc(arenaLink(room.code)) + '">📺 Open arena</a></div>';
        $("btnCopy").addEventListener("click", () => {
          const v = $("roomLink").value;
          (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(
            () => MBA.toast("Room link copied!"),
            () => { $("roomLink").select(); document.execCommand("copy"); MBA.toast("Room link copied!"); });
        });
      }
    }
    const joined = T.students.filter(s => s.joinedAt).sort((a, b) => a.name.localeCompare(b.name));
    const notJoined = T.students.filter(s => !s.joinedAt).sort((a, b) => a.name.localeCompare(b.name));
    $("joinedN").textContent = "(" + joined.length + ")";
    $("notJoinedN").textContent = "(" + notJoined.length + ")";
    setHTML("joinedList", joined.map(s => '<span class="chip ' + (MBA.TEAM[s.team] || {}).cls + '" dir="auto"><span class="dot"></span>' + esc(s.name) + '</span>').join("") || '<span class="muted">Nobody yet.</span>');
    setHTML("notJoinedList", notJoined.map(s => '<span class="chip" dir="auto">' + esc(s.name) + '</span>').join("") || (T.students.length ? '<span class="muted">Everyone has joined 🎉</span>' : '<span class="muted">No students uploaded yet. Open the Students tab.</span>'));
  }

  function setHTML(id, html) { const el = $(id); if (el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; } }

  function renderControl() {
    const st = T.settings, room = T.room, s = st.status;
    const qn = T.questions.length;
    const set = (c, dis) => document.querySelectorAll('[data-cmd="' + c + '"]').forEach(b => b.disabled = dis);
    const live = s === "running" || s === "paused";
    set("start", !room || s !== "lobby");
    set("pause", s !== "running");
    set("resume", s !== "paused");
    set("prev", !live || st.qIndex <= 0);
    set("next", !live || st.qIndex >= qn - 1);
    set("end", !live);
    set("reset", !room || s === "lobby");
    $("gcQ").textContent = st.qIndex >= 0 ? (st.qIndex + 1) + "/" + qn : "–/" + qn;
    const joined = T.students.filter(x => x.joinedAt).length;
    const answered = st.qIndex >= 0 ? T.submissions.filter(x => x.qIndex === st.qIndex).length : 0;
    $("gcAns").textContent = answered + "/" + joined;
    let hint = "";
    if (!room) hint = "Create a room first.";
    else if (s === "lobby") hint = "Students join with the room link. Press Start when everyone is in.";
    else if (s === "ended") hint = "Game over. Finish reviewing answers — scores keep updating. Press Reset to play again in this room.";
    else if (T.timing.gameTimeUp) hint = "⏰ The 7 minutes are over — answers are closed. Review answers, then press End game.";
    else if (s === "paused") hint = "Paused. All timers are frozen.";
    $("gcHint").textContent = hint;
  }

  function tickClocks() {
    if (!T) return;
    const st = T.settings;
    const drift = st.status === "running" ? Date.now() - TAt : 0;
    if (st.status === "running" || st.status === "paused") {
      const q = st.questionSeconds * 1000 - (T.timing.qElapsedMs + drift);
      const g = st.gameSeconds * 1000 - (T.timing.gameElapsedMs + drift);
      $("gcQT").textContent = Math.max(0, Math.ceil(Math.min(q, g) / 1000)) + "s";
      $("gcGT").textContent = MBA.fmtClock(g);
    } else if (st.status === "ended") {
      $("gcQT").textContent = "–"; $("gcGT").textContent = MBA.fmtClock(st.gameSeconds * 1000 - T.timing.gameElapsedMs);
    } else { $("gcQT").textContent = "–"; $("gcGT").textContent = MBA.fmtClock(st.gameSeconds * 1000); }
  }
  setInterval(tickClocks, 250);

  function renderCurQ() {
    const st = T.settings;
    const q = T.questions[st.qIndex];
    if (!q || st.qIndex < 0) {
      setHTML("curQ", '<p class="muted" style="margin:0">The game has not started. ' + T.questions.length + ' questions are ready.</p>');
      return;
    }
    setHTML("curQ", '<p style="font-weight:800;font-size:1.1rem;margin:0 0 10px" dir="auto">' + esc(q.text) + '</p>' +
      q.options.map((o, i) => {
        const L = "ABCD"[i];
        return '<div class="row" style="margin:4px 0"><span class="letterbox" style="--oc:var(--opt' + L + ')">' + L + '</span><span dir="auto">' + esc(o) + '</span>' + (q.answerKey === L ? ' <span class="st correct">← answer key</span>' : '') + '</div>';
      }).join(""));
  }

  /* ---------------- review ---------------- */
  function renderReview() {
    const st = T.settings;
    const qn = T.questions.length;
    const q = reviewQ !== null ? reviewQ : Math.max(0, st.qIndex);
    // question chips
    const chips = T.questions.map((_, i) => {
      const subs = T.submissions.filter(s => s.qIndex === i);
      const pend = subs.filter(s => s.status === "pending").length;
      return '<button class="qchip' + (i === q ? ' active' : '') + (i === st.qIndex && (st.status === "running" || st.status === "paused") ? ' live' : '') + '" data-q="' + i + '">Q' + (i + 1) + ' <small>' + subs.length + (pend ? ' · ' + pend + ' to check' : '') + '</small></button>';
    }).join("");
    setHTML("qchips", chips);
    const Q = T.questions[q];
    if (!Q) { setHTML("keyhint", "No questions."); return; }
    const key = Q.answerKey;
    setHTML("keyhint", '<b>Q' + (q + 1) + ':</b> <span dir="auto">' + esc(Q.text) + '</span><br>' +
      Q.options.map((o, i) => '<span style="margin-inline-end:14px">' + (key === "ABCD"[i] ? "✅ " : "") + '<b>' + "ABCD"[i] + '</b> ' + esc(o) + '</span>').join(""));
    const subs = T.submissions.filter(s => s.qIndex === q).sort((a, b) => a.submittedAt - b.submittedAt);
    const pend = subs.filter(s => s.status === "pending").length;
    $("btnBulk").disabled = !pend || !key;
    $("btnBulk").textContent = key ? "Mark " + pend + " pending: " + key + " = Correct, others = Incorrect" : "Mark all pending";
    $("btnBulk").dataset.q = q; $("btnBulk").dataset.key = key;
    $("bulkHint").textContent = key ? "(You can still change any row after.)" : "";

    // keep the table still while the teacher types in an adjust box
    const tbody = $("reviewBody");
    if (tbody.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
    const html = subs.map(s => {
      const L = s.answer;
      const opt = Q.options["ABCD".indexOf(L)] || "";
      return '<tr class="' + s.status + '" data-id="' + esc(s.id) + '">' +
        '<td dir="auto"><b>' + esc(s.name) + '</b></td>' +
        '<td>' + teamChip(s.team) + '</td>' +
        '<td><span class="letterbox" style="--oc:var(--opt' + L + ')">' + esc(L) + '</span> <span dir="auto">' + esc(opt) + '</span></td>' +
        '<td>' + s.seconds + ' s <span class="muted">(' + MBA.pointsFor(s.seconds) + ')</span></td>' +
        '<td><span class="st ' + s.status + '">' + s.status + '</span></td>' +
        '<td><b>' + s.points + '</b></td>' +
        '<td><div class="row" style="flex-wrap:nowrap;gap:6px">' +
        '<button class="btn btn-sm btn-green" data-act="correct" title="Mark correct">✓ Correct</button>' +
        '<button class="btn btn-sm btn-red" data-act="incorrect" title="Mark incorrect">✗ Incorrect</button>' +
        '<button class="btn btn-sm btn-ghost" data-act="pending" title="Undo"' + (s.status === "pending" ? " disabled" : "") + '>↺ Undo</button></div></td>' +
        '<td><div class="row" style="flex-wrap:nowrap;gap:6px"><input class="mini-input" type="number" min="0" max="1000" step="5" placeholder="pts"><button class="btn btn-sm" data-act="adjust">Set</button></div></td>' +
        '</tr>';
    }).join("") || '<tr><td colspan="8" class="muted">No answers for this question yet.</td></tr>';
    if (tbody.dataset.h !== html) { tbody.dataset.h = html; tbody.innerHTML = html; }

    const answered = new Set(subs.map(s => s.studentId));
    const missing = T.students.filter(s => s.joinedAt && !answered.has(s.id));
    $("noAnsN").textContent = "(" + missing.length + ")";
    setHTML("noAnsList", missing.map(s => '<span class="chip" dir="auto">' + esc(s.name) + '</span>').join("") || '<span class="muted">—</span>');
  }

  $("qchips").addEventListener("click", e => {
    const b = e.target.closest(".qchip"); if (!b) return;
    const q = Number(b.dataset.q);
    reviewQ = (T && q === Math.max(0, T.settings.qIndex)) ? null : q;
    $("reviewBody").dataset.h = "";
    render();
  });

  $("reviewBody").addEventListener("click", async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const tr = b.closest("tr"), id = tr.dataset.id, act = b.dataset.act;
    b.disabled = true;
    try {
      if (act === "adjust") {
        const inp = tr.querySelector("input");
        if (inp.value === "") { MBA.toast("Type the points first.", true); return; }
        await call("adjust", { submissionId: id, points: Number(inp.value) }, "Points updated");
        inp.value = ""; inp.blur();
      } else {
        await call("review", { submissionId: id, status: act });
      }
    } catch (err) { } finally { b.disabled = false; }
  });
  $("reviewBody").addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.tagName === "INPUT") e.target.closest("tr").querySelector('[data-act="adjust"]').click();
  });

  $("btnBulk").addEventListener("click", async () => {
    const b = $("btnBulk");
    const q = Number(b.dataset.q), key = b.dataset.key;
    if (!confirm("Mark all PENDING answers for Q" + (q + 1) + ":\n" + key + " = Correct, everything else = Incorrect?")) return;
    b.disabled = true;
    try { const r = await call("bulkReview", { qIndex: q, answer: key }); MBA.toast(r.changed + " answers marked"); } catch (e) { }
  });

  /* ---------------- game control ---------------- */
  document.querySelectorAll("[data-cmd]").forEach(b => b.addEventListener("click", async () => {
    const cmd = b.dataset.cmd;
    if (cmd === "end" && !confirm("End the game now and show the winner?")) return;
    if (cmd === "reset" && !confirm("Reset the game? All answers and points in this room will be deleted. Students stay joined.")) return;
    b.disabled = true;
    try { await call("control", { cmd }); if (cmd === "next" || cmd === "prev" || cmd === "start") { reviewQ = null; } }
    catch (e) { } finally { setTimeout(() => render(), 50); }
  }));

  $("btnCreateRoom").addEventListener("click", async () => {
    if (T && T.room && !confirm("Create a NEW room? The current room " + T.room.code + " will close and students must join the new code.")) return;
    $("btnCreateRoom").disabled = true;
    try { const r = await call("createRoom", { name: $("roomName").value.trim() }, "Room created"); $("roomName").value = ""; reviewQ = null; $("roomInfo").dataset.sig = ""; }
    catch (e) { } finally { $("btnCreateRoom").disabled = false; }
  });

  /* ---------------- students ---------------- */
  function renderStudents() {
    const counts = { Blue: 0, Green: 0, none: 0 };
    T.students.forEach(s => { if (counts[s.team] !== undefined) counts[s.team]++; else counts.none++; });
    $("teamCounts").innerHTML = "🔵 Blue: <b>" + counts.Blue + "</b> &nbsp; 🟢 Green: <b>" + counts.Green + "</b> &nbsp; Without team: <b>" + counts.none + "</b>";
    $("btnAuto").disabled = !counts.none;
    $("stuN").textContent = "(" + T.students.length + ")";
    const tbody = $("stuBody");
    if (tbody.contains(document.activeElement) && document.activeElement.tagName === "SELECT") return;
    const f = MBA.normName($("stuFilter").value);
    const rows = T.students.filter(s => !f || MBA.normName(s.name).includes(f)).sort((a, b) => a.name.localeCompare(b.name));
    const html = rows.map(s =>
      '<tr data-id="' + esc(s.id) + '"><td dir="auto"><b>' + esc(s.name) + '</b></td>' +
      '<td><select class="mini" data-act="team"><option value=""' + (!MBA.TEAM[s.team] ? " selected" : "") + '>— choose —</option>' +
      '<option value="Blue"' + (s.team === "Blue" ? " selected" : "") + '>🔵 Blue – Number Ninjas</option>' +
      '<option value="Green"' + (s.team === "Green" ? " selected" : "") + '>🟢 Green – Math Titans</option></select></td>' +
      '<td>' + (s.joinedAt ? '<span class="st correct">joined</span>' : '<span class="muted">not joined</span>') + '</td>' +
      '<td>' + s.score + '</td>' +
      '<td><div class="row" style="flex-wrap:nowrap;gap:6px">' + (s.joinedAt ? '<button class="btn btn-sm btn-ghost" data-act="release" title="Let this student join again from another device">Release</button>' : '') +
      '<button class="btn btn-sm btn-red" data-act="remove">Remove</button></div></td></tr>'
    ).join("") || '<tr><td colspan="5" class="muted">No students yet. Upload your class list above.</td></tr>';
    if (tbody.dataset.h !== html) { tbody.dataset.h = html; tbody.innerHTML = html; }
  }
  $("stuFilter").addEventListener("input", () => T && renderStudents());

  $("stuBody").addEventListener("change", async e => {
    if (e.target.dataset.act !== "team") return;
    const id = e.target.closest("tr").dataset.id;
    e.target.blur();
    try { await call("setTeam", { studentId: id, team: e.target.value }, "Team saved"); } catch (err) { }
  });
  $("stuBody").addEventListener("click", async e => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const tr = b.closest("tr"), id = tr.dataset.id, name = tr.querySelector("b").textContent;
    if (b.dataset.act === "remove") {
      if (!confirm("Remove " + name + " from the class list?")) return;
      b.disabled = true;
      try { await call("removeStudent", { studentId: id }, name + " removed"); } catch (err) { b.disabled = false; }
    } else if (b.dataset.act === "release") {
      if (!confirm("Release " + name + "? They can then join again (for example from a different device). Their points are kept.")) return;
      try { await call("releaseStudent", { studentId: id }, name + " released"); } catch (err) { }
    }
  });

  $("btnAdd").addEventListener("click", async () => {
    const name = $("addName").value.trim();
    if (!name) return;
    try {
      const r = await call("addStudent", { name, team: $("addTeam").value });
      if (r.added) { MBA.toast(name + " added"); $("addName").value = ""; } else MBA.toast("That name is already on the list.", true);
    } catch (e) { }
  });
  $("btnAuto").addEventListener("click", async () => {
    try { const r = await call("autoTeams", {}); MBA.toast(r.changed + " students assigned"); } catch (e) { }
  });

  /* ---------------- upload (CSV / Excel / paste) ---------------- */
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const firstLine = text.split(/\r?\n/)[0] || "";
    const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : (firstLine.includes("\t") ? "\t" : ",");
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim || c === "،") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += c;
    }
    row.push(cur); rows.push(row);
    return rows;
  }

  function rowsToStudents(rows) {
    rows = rows.map(r => r.map(c => String(c ?? "").trim())).filter(r => r.some(c => c));
    if (!rows.length) return [];
    const head = rows[0].map(c => MBA.normName(c));
    const find = re => head.findIndex(h => re.test(h));
    let nameCol = 0, teamCol = 1, firstCol = -1, lastCol = -1, hasHeader = false;
    const n = find(/(^|\s)(full ?name|student|name|الاسم|اسم|الطالب)/);
    const t = find(/(team|group|colou?r|الفريق|فريق|المجموعه)/);
    const f = find(/(first|الاول)/), l = find(/(last|family|surname|العائله|الاخير)/);
    if (n >= 0 || t >= 0 || f >= 0) {
      hasHeader = true;
      if (f >= 0 && l >= 0) { firstCol = f; lastCol = l; }
      nameCol = n >= 0 ? n : 0;
      teamCol = t;
    }
    const body = hasHeader ? rows.slice(1) : rows;
    return body.map(r => ({
      name: (firstCol >= 0 ? (r[firstCol] + " " + r[lastCol]) : r[nameCol] || "").replace(/\s+/g, " ").trim(),
      team: teamCol >= 0 ? (r[teamCol] || "") : ""
    })).filter(s => s.name && !/^\d+$/.test(s.name));
  }

  function setPending(list, source) {
    pendingRows = list;
    $("btnUpload").disabled = !list.length;
    const withTeam = list.filter(s => /blue|green|ازرق|أزرق|اخضر|أخضر/i.test(s.team)).length;
    $("upPreview").textContent = list.length ? list.length + " names found in " + source + " (" + withTeam + " with a team)" : "No names found.";
  }

  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = res; s.onerror = () => rej(new Error("Could not load the Excel reader. Save the file as CSV and try again."));
      document.head.appendChild(s);
    });
  }

  async function readFile(file) {
    $("upMsg").textContent = ""; $("upMsg").className = "msg";
    try {
      let rows;
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        await loadSheetJS();
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
      } else {
        rows = parseCSV(await file.text());
      }
      setPending(rowsToStudents(rows), file.name);
      $("paste").value = "";
    } catch (e) { $("upMsg").textContent = e.message; $("upMsg").className = "msg err"; }
  }

  $("file").addEventListener("change", e => e.target.files[0] && readFile(e.target.files[0]));
  const drop = $("drop");
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0]));
  $("paste").addEventListener("input", () => setPending(rowsToStudents(parseCSV($("paste").value)), "pasted text"));

  $("btnUpload").addEventListener("click", async () => {
    if (!pendingRows || !pendingRows.length) return;
    const mode = $("upMode").value;
    if (mode === "replace" && !confirm("Replace the WHOLE student list with " + pendingRows.length + " names?")) return;
    $("btnUpload").disabled = true;
    try {
      const r = await call("uploadStudents", { students: pendingRows, mode });
      $("upMsg").className = "msg ok";
      $("upMsg").textContent = "✅ " + r.added + " students added." + (r.skipped.length ? " Skipped " + r.skipped.length + " duplicate(s): " + r.skipped.slice(0, 8).join(", ") + (r.skipped.length > 8 ? "…" : "") : "");
      pendingRows = null; $("upPreview").textContent = ""; $("paste").value = ""; $("file").value = "";
    } catch (e) { $("btnUpload").disabled = false; }
  });

  /* ---------------- leaderboard ---------------- */
  function renderBoard() {
    const teams = [["Blue", T.teams.Blue], ["Green", T.teams.Green]].sort((a, b) => b[1] - a[1]);
    setHTML("teamRank", teams.map((t, i) => {
      const m = MBA.TEAM[t[0]];
      const n = T.students.filter(s => s.team === t[0] && s.joinedAt).length;
      return '<div class="lb-row ' + m.cls + '" style="padding:14px"><span class="rank">' + (teams[0][1] === teams[1][1] ? "=" : "#" + (i + 1)) + '</span>' +
        '<img src="' + m.img + '" width="56" height="56" alt=""><div><b>' + m.emoji + " " + m.label + '</b><div class="muted">' + m.name + ' · ' + n + ' players</div></div>' +
        '<span class="pts" style="font-size:2rem">' + t[1] + '</span></div>';
    }).join(""));
    const ind = T.students.filter(s => s.joinedAt || s.score).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    setHTML("indRank", ind.map((s, i) =>
      '<div class="lb-row"><span class="rank">' + (i + 1) + '</span>' + teamChip(s.team) + '<span dir="auto">' + esc(s.name) + '</span><span class="pts">' + s.score + '</span></div>'
    ).join("") || '<p class="muted">No players yet.</p>');
  }

  /* ---------------- start ---------------- */
  if (!MBA.configured()) { showLogin("The game server is not set up yet: paste your API URL into assets/js/config.js."); $("btnLogin").disabled = true; }
  else if (token) showDash();
  else showLogin();
})();
