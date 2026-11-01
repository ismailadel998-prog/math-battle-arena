/**
 * MATH BATTLE ARENA — optional Cloudflare Worker proxy (free plan is enough)
 *
 * Why use it?
 *  - Hides your Google Apps Script URL from the website code.
 *  - Answers CORS correctly for every browser.
 *  - Caches the shared game state for 1 second, so 40+ students polling at once
 *    put much less load on Google Apps Script.
 *
 * Setup: Cloudflare dashboard > Workers & Pages > Create Worker > paste this file > Deploy.
 * Then Settings > Variables and Secrets > add  APPS_SCRIPT_URL = https://script.google.com/macros/s/XXXX/exec
 * Put the Worker URL (https://xxxx.workers.dev) into assets/js/config.js.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (!env.APPS_SCRIPT_URL) return json({ ok: false, error: "NOT_CONFIGURED", message: "APPS_SCRIPT_URL is not set on the Worker." }, 500);

    const url = new URL(request.url);
    const target = new URL(env.APPS_SCRIPT_URL);
    url.searchParams.forEach((v, k) => target.searchParams.set(k, v));

    try {
      if (request.method === "GET") {
        const cacheable = target.searchParams.get("action") === "state";
        const cache = caches.default;
        const key = new Request("https://mba-cache/state?code=" + (target.searchParams.get("code") || ""));
        if (cacheable) {
          const hit = await cache.match(key);
          if (hit) return withCors(hit);
        }
        const res = await fetch(target.toString(), { redirect: "follow" });
        const body = await res.text();
        const out = new Response(body, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=1" } });
        if (cacheable && body.includes('"ok":true')) ctx.waitUntil(cache.put(key, out.clone()));
        return withCors(out);
      }
      if (request.method === "POST") {
        const body = await request.text();
        const res = await fetch(target.toString(), {
          method: "POST", redirect: "follow",
          headers: { "Content-Type": "text/plain;charset=utf-8" }, body
        });
        return withCors(new Response(await res.text(), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }));
      }
      return json({ ok: false, error: "METHOD", message: "Method not allowed" }, 405);
    } catch (e) {
      return json({ ok: false, error: "PROXY", message: "Could not reach the game server. Try again." }, 502);
    }
  }
};

function withCors(res) {
  const r = new Response(res.body, res);
  Object.entries(CORS).forEach(([k, v]) => r.headers.set(k, v));
  return r;
}
function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
