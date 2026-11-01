/* MATH BATTLE ARENA — arena / presentation screen (read-only, follows the teacher) */
(function () {
  const $ = id => document.getElementById(id);
  const esc = MBA.esc;
  const params = new URLSearchParams(location.search);
  let code = (params.get("room") || "").toUpperCase().replace(/[^A-Z]/g, "");
  let S = null, SAt = 0, lastQ = null, celebrated = false;

  $("aRing").innerHTML = MBA.ringHTML();
  const poll = MBA.poller(refresh, 1500);

  async function refresh() {
    try {
      S = await MBA.apiGet("state", code ? { code } : {});
      SAt = Date.now();
      render();
    } catch (e) {
      if (e.code === "ROOM_CLOSED" && code) { code = ""; history.replaceState(null, "", location.pathname); return; }
      throw e;
    }
  }

  function render() {
    const s = S;
    const room = s.room;
    $("roomName").textContent = room ? room.name + (room.className ? " · " + room.className : "") : "No active room";
    $("roomCode").textContent = room ? room.code : "-----";
    $("bigCode").textContent = room ? room.code : "-----";
    const link = new URL("./", location.href).href + (room ? "?room=" + room.code : "");
    $("joinUrl").textContent = link;

    MBA.animateNumber($("sBlue"), s.teams.Blue);
    MBA.animateNumber($("sGreen"), s.teams.Green);
    $("tpBlue").classList.toggle("leading", s.teams.Blue > s.teams.Green);
    $("tpGreen").classList.toggle("leading", s.teams.Green > s.teams.Blue);
    const blue = s.players.filter(p => p.team === "Blue"), green = s.players.filter(p => p.team === "Green");
    $("nBlue").textContent = blue.length; $("nGreen").textContent = green.length;

    const live = s.status === "running" || s.status === "paused";
    $("stLobby").hidden = s.status !== "lobby";
    $("stQuestion").hidden = !live;
    $("stEnd").hidden = s.status !== "ended";
    $("foot").style.visibility = live ? "visible" : "hidden";

    if (s.status === "lobby") {
      celebrated = false; lastQ = null;
      const chips = list => list.map(p => '<span class="chip ' + MBA.TEAM[p.team].cls + '" dir="auto"><span class="dot"></span>' + esc(p.name) + '</span>').join("");
      setHTML("rosterBlue", chips(blue));
      setHTML("rosterGreen", chips(green));
    }

    if (live && s.question) {
      if (lastQ !== s.qIndex) {
        lastQ = s.qIndex;
        $("aQnum").textContent = "QUESTION " + (s.qIndex + 1) + " OF " + s.qCount;
        $("aQtext").textContent = s.question.text;
        $("aAnswers").innerHTML = s.question.options.map((o, i) =>
          '<div class="ans" data-l="' + "ABCD"[i] + '"><span class="letter">' + "ABCD"[i] + '</span><span dir="auto">' + esc(o) + '</span></div>').join("");
        $("stQuestion").classList.remove("screen"); void $("stQuestion").offsetWidth;
        $("stQuestion").style.animation = "none"; void $("stQuestion").offsetWidth; $("stQuestion").style.animation = "slidein .45s ease";
      }
      $("progress").innerHTML = Array.from({ length: s.qCount }, (_, i) => '<i class="' + (i < s.qIndex ? "done" : i === s.qIndex ? "now" : "") + '"></i>').join("");
      const n = s.joinedCount || 0;
      $("ansTxt").textContent = s.submittedCount + " / " + n + " answered";
      $("ansBar").style.width = (n ? Math.round(100 * s.submittedCount / n) : 0) + "%";
    }

    if (s.status === "paused") showOverlay("PAUSED ⏸");
    else if (live && s.gameTimeUp) showOverlay("TIME'S UP! ⏰");
    else $("overlay").hidden = true;

    if (s.status === "ended") {
      const w = s.winner, t = MBA.TEAM[w];
      $("winMascot").src = t ? t.img : "assets/img/favicon.svg";
      $("stEnd").className = "celebrate " + (t ? t.cls : "");
      $("winTitle").textContent = t ? t.label + " – " + t.name + " WIN! 🏆" : "IT'S A TIE! 🤝";
      const top = s.players.slice().sort((a, b) => b.score - a.score).slice(0, 3);
      setHTML("top3", top.map((p, i) => '<div class="card ' + MBA.TEAM[p.team].cls + '">' + ["🥇", "🥈", "🥉"][i] + ' <span dir="auto">' + esc(p.name) + '</span> · ' + p.score + '</div>').join(""));
      if (!celebrated) {
        celebrated = true;
        MBA.confetti(w === "Blue" ? ["#2f8cff", "#8cc4ff", "#ffcc33", "#fff"] : w === "Green" ? ["#22d36f", "#8ff0b6", "#ffcc33", "#fff"] : ["#2f8cff", "#22d36f", "#ffcc33"], 8000);
      }
    }
  }

  function setHTML(id, html) { const el = $(id); if (el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; } }
  function showOverlay(t) { $("ovText").textContent = t; $("overlay").hidden = false; }

  setInterval(() => {
    const s = S;
    if (!s) return;
    if (s.status === "running" || s.status === "paused") {
      const drift = s.status === "running" ? Date.now() - SAt : 0;
      const q = s.qSeconds * 1000 - (s.qElapsedMs + drift);
      const g = s.gameSeconds * 1000 - (s.gameElapsedMs + drift);
      MBA.setRing($("aRing"), Math.min(q, g), s.qSeconds * 1000);
      $("aClock").textContent = "GAME " + MBA.fmtClock(g);
    } else {
      MBA.setRing($("aRing"), s.status === "ended" ? 0 : s.qSeconds * 1000, s.qSeconds * 1000);
      if (s.status === "lobby") $("aRing").querySelector(".num").textContent = "VS";
      $("aClock").textContent = "GAME " + MBA.fmtClock(s.status === "ended" ? s.gameSeconds * 1000 - s.gameElapsedMs : s.gameSeconds * 1000);
    }
  }, 250);

  if (!MBA.configured()) { $("roomName").textContent = "Server not configured (assets/js/config.js)"; }
  else poll.start();
})();
