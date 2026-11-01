/*
 * Local test server.
 *  :8787  fake Apps Script web app. Like Google, POST /exec answers with a 302 redirect
 *         to a second URL that returns the JSON (so the browser redirect + CORS path is exercised).
 *  :8080  static website (the GitHub Pages files) with config.js pointing at :8787.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { createRuntime } = require("./gas-mock");

const rt = createRuntime();
rt.sandbox.setup();
const ROOT = path.join(__dirname, "..");
const pending = new Map();
let n = 0;
let glitch = { mode: "", left: 0 };   // test hook: make the next N "state" replies look broken

const API_PORT = Number(process.env.API_PORT || 8787), WEB_PORT = Number(process.env.WEB_PORT || 8080);

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const cors = { "Access-Control-Allow-Origin": "*" };
  if (u.pathname === "/__advance") { rt.advance(Number(u.searchParams.get("ms"))); res.writeHead(200, cors); return res.end("ok"); }
  if (u.pathname === "/__glitch") { glitch = { mode: u.searchParams.get("mode"), left: Number(u.searchParams.get("n")) }; res.writeHead(200, cors); return res.end("ok"); }
  if (u.pathname === "/__sheet") { res.writeHead(200, { ...cors, "Content-Type": "application/json" }); return res.end(JSON.stringify(rt.sheet(u.searchParams.get("name")))); }
  if (req.method === "OPTIONS") { res.writeHead(405); return res.end(); }   // Apps Script cannot answer preflight
  if (u.pathname === "/exec" && req.method === "GET") {
    const params = Object.fromEntries(u.searchParams);
    let reply = rt.doGet(params);
    if (params.action === "state" && glitch.left > 0) {
      glitch.left--;
      reply = glitch.mode === "closed" ? { ok: false, error: "ROOM_CLOSED", message: "glitch" } : { ...reply, players: [] };
    }
    const out = JSON.stringify(reply);
    const k = "g" + (++n); pending.set(k, out);
    res.writeHead(302, { ...cors, Location: "http://localhost:" + API_PORT + "/echo?k=" + k }); return res.end();
  }
  if (u.pathname === "/exec" && req.method === "POST") {
    let body = ""; req.on("data", c => body += c);
    req.on("end", () => {
      const out = JSON.stringify(rt.doPost(body));
      const k = "p" + (++n); pending.set(k, out);
      res.writeHead(302, { ...cors, Location: "http://localhost:" + API_PORT + "/echo?k=" + k }); res.end();
    });
    return;
  }
  if (u.pathname === "/echo") {
    const out = pending.get(u.searchParams.get("k")); pending.delete(u.searchParams.get("k"));
    res.writeHead(out ? 200 : 404, { ...cors, "Content-Type": "application/json" }); return res.end(out || "");
  }
  res.writeHead(404); res.end();
}).listen(API_PORT);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  if (p === "/assets/js/config.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    return res.end('window.MBA_CONFIG = { API_URL: "http://localhost:' + API_PORT + '/exec" };');
  }
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(WEB_PORT);

console.log("API http://localhost:" + API_PORT + "/exec   WEB http://localhost:" + WEB_PORT + "/");
