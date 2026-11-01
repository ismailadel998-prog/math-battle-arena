/* MATH BATTLE ARENA — shared helpers (students, teacher, arena) */
(function () {
  const cfg = window.MBA_CONFIG || {};
  const API = (window.MBA_API_OVERRIDE || cfg.API_URL || "").trim();

  function configured() { return API && API.indexOf("PASTE_") !== 0; }

  /** GET request (used for polling state; cache-friendly, no CORS preflight). */
  async function apiGet(action, params = {}) {
    if (!configured()) throw apiError("NOT_CONFIGURED", "The game server is not configured yet (assets/js/config.js).");
    const qs = new URLSearchParams({ action, ...params });
    return handle(await fetch(API + (API.includes("?") ? "&" : "?") + qs.toString(), { method: "GET", cache: "no-store", redirect: "follow" }));
  }

  /** POST request. text/plain avoids the CORS preflight that Apps Script cannot answer. */
  async function apiPost(action, data = {}) {
    if (!configured()) throw apiError("NOT_CONFIGURED", "The game server is not configured yet (assets/js/config.js).");
    const res = await fetch(API, {
      method: "POST", redirect: "follow", cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...data })
    });
    return handle(res);
  }

  async function handle(res) {
    let text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch (e) {
      throw apiError("BAD_RESPONSE", "The server sent an unexpected reply. Check that the Apps Script is deployed with access 'Anyone'.");
    }
    if (!data.ok) throw apiError(data.error || "ERROR", data.message || "Something went wrong.");
    return data;
  }

  function apiError(code, message) { const e = new Error(message); e.code = code; return e; }

  /** Normalise Arabic + English text for matching (case, accents, hamza forms, taa marbuta…). */
  function normName(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ًͯ-ٰٟـ]/g, "")
      .toLowerCase().replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
      .replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/\s+/g, " ").trim();
  }

  /**
   * Smart search: matches the BEGINNING OF THE FIRST NAME only.
   * "Moh" -> Mohamed Adel, Mohamed Ahmed (not Hossam Mohamed).
   * If the student keeps typing past a space ("Mohamed Ad") the whole name is matched from the start.
   */
  function searchNames(list, query, limit = 8) {
    const q = normName(query);
    if (!q) return [];
    return list.filter(s => {
      const n = normName(s.name);
      if (q.includes(" ")) return n.startsWith(q);
      return n.split(" ")[0].startsWith(q);
    }).sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /** Same rule as the server: the speed bands stretch with the time per question (60 s = original table). */
  function pointsFor(seconds, questionSeconds) {
    const s = Number(seconds), k = (Number(questionSeconds) || 60) / 60;
    if (s <= 10 * k) return 100; if (s <= 20 * k) return 80; if (s <= 30 * k) return 60;
    if (s <= 45 * k) return 40; if (s <= 60 * k) return 20; return 0;
  }

  const TEAM = {
    Blue: { cls: "team-blue", name: "NUMBER NINJAS", label: "BLUE TEAM", emoji: "🔵", img: "assets/img/ninja.svg" },
    Green: { cls: "team-green", name: "MATH TITANS", label: "GREEN TEAM", emoji: "🟢", img: "assets/img/titan.svg" }
  };

  function fmtClock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function toast(msg, isErr) {
    document.querySelectorAll(".toast").forEach(t => t.remove());
    const t = document.createElement("div");
    t.className = "toast" + (isErr ? " err" : "");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  /** Clock synchronised with the server so every device shows the same countdown. */
  const clock = {
    offset: 0,
    sync(serverNow, sentAt) {
      const now = Date.now();
      const latency = sentAt ? (now - sentAt) / 2 : 0;
      const off = serverNow + latency - now;
      this.offset = this.offset ? this.offset * 0.7 + off * 0.3 : off;
    },
    now() { return Date.now() + this.offset; }
  };

  /** Repeating poller with back-off on errors and a connection badge. */
  function poller(fn, interval) {
    let timer = null, fails = 0, stopped = false, badge = null;
    async function tick() {
      if (stopped) return;
      try {
        await fn();
        fails = 0;
        if (badge) { badge.remove(); badge = null; }
      } catch (e) {
        fails++;
        if (fails >= 3 && !badge && e.code !== "ROOM_CLOSED") {
          badge = document.createElement("div");
          badge.className = "conn"; badge.textContent = "Reconnecting…";
          document.body.appendChild(badge);
        }
      }
      const jitter = Math.random() * 400;
      timer = setTimeout(tick, Math.min(interval * Math.pow(1.5, Math.min(fails, 4)), 10000) + jitter);
    }
    return {
      start() { stopped = false; clearTimeout(timer); tick(); },
      now() { clearTimeout(timer); tick(); },
      stop() { stopped = true; clearTimeout(timer); }
    };
  }

  function setRing(el, remainingMs, totalMs) {
    if (!el) return;
    const r = 42, c = 2 * Math.PI * r;
    const bar = el.querySelector(".bar"), num = el.querySelector(".num");
    const frac = totalMs ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
    bar.setAttribute("stroke-dasharray", c.toFixed(1));
    bar.setAttribute("stroke-dashoffset", (c * (1 - frac)).toFixed(1));
    const secs = Math.max(0, Math.ceil(remainingMs / 1000));
    num.textContent = secs > 60 ? Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0") : secs;
    el.classList.toggle("warn", remainingMs <= 10000 && remainingMs > 0);
  }

  function ringHTML() {
    return '<svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="42"/><circle class="bar" cx="50" cy="50" r="42"/></svg><div class="num">–</div>';
  }

  /** Simple confetti burst in the given team colours. */
  function confetti(colors, duration = 5000) {
    let cv = document.getElementById("confetti");
    if (!cv) { cv = document.createElement("canvas"); cv.id = "confetti"; document.body.appendChild(cv); }
    const ctx = cv.getContext("2d");
    const W = cv.width = innerWidth, H = cv.height = innerHeight;
    const parts = Array.from({ length: 160 }, () => ({
      x: Math.random() * W, y: -20 - Math.random() * H, w: 6 + Math.random() * 8, h: 8 + Math.random() * 10,
      vy: 2 + Math.random() * 4, vx: -2 + Math.random() * 4, r: Math.random() * 6, vr: -.2 + Math.random() * .4,
      c: colors[Math.floor(Math.random() * colors.length)]
    }));
    const end = Date.now() + duration;
    (function frame() {
      ctx.clearRect(0, 0, W, H);
      parts.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        if (p.y > H && Date.now() < end) { p.y = -20; p.x = Math.random() * W; }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      if (Date.now() < end + 3000) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    })();
  }

  function animateNumber(el, to) {
    const from = Number(el.dataset.v || 0);
    if (from === to) { el.textContent = to; return; }
    el.dataset.v = to;
    el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
    const start = performance.now(), dur = 800;
    (function step(t) {
      const k = Math.min(1, (t - start) / dur);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    })(start);
  }

  window.MBA = { apiGet, apiPost, configured, normName, searchNames, esc, pointsFor, TEAM, fmtClock, toast, clock, poller, setRing, ringHTML, confetti, animateNumber };
})();
