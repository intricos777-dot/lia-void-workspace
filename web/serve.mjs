// Local console for the Lia workspace. Binds 127.0.0.1 only.
//   node web/serve.mjs
// Serves the static console and proxies the two local services so the browser
// never has to hold a token.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nousToken, collectorToken, voidBridgeToken, config } from "../src/config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const c = config();

async function readBody(req) {
  const MAX = 2 * 1024 * 1024;
  let n = 0;
  const chunks = [];
  for await (const ch of req) {
    n += ch.length;
    if (n > MAX) throw new Error("request body too large");
    chunks.push(ch);
  }
  return chunks.length ? Buffer.concat(chunks).toString("utf8") : null;
}

// Loopback-only guards. The console binds 127.0.0.1, which stops remote hosts but
// NOT the user's own browser: any page the browser loads can POST to localhost.
// A cross-origin "simple request" (text/plain, no preflight) would otherwise reach
// /api/content and spend the Nous token, and a DNS-rebinding page could read the
// responses. Require a loopback Host and refuse any non-loopback Origin.
const LOCAL_HOSTS = new Set(["127.0.0.1:8788", "localhost:8788", "[::1]:8788"]);
const LOCAL_NAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function hostAllowed(req) {
  return LOCAL_HOSTS.has(String(req.headers.host || "").toLowerCase());
}

function originAllowed(req) {
  const o = req.headers.origin;
  if (!o) return true; // same-origin fetches and CLI clients send no Origin
  try {
    const u = new URL(o);
    return LOCAL_NAMES.has(u.hostname) && (u.port === "" || u.port === "8788");
  } catch {
    return false;
  }
}

// Only GET reads and the one POST action exist; anything else is refused rather
// than silently falling through to a route.
const GET_ONLY = new Set(["/api/status", "/api/memory", "/api/ideas"]);
const POST_ONLY = new Set(["/api/content"]);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  res.setHeader("Cache-Control", "no-store");

  if (!hostAllowed(req)) return json(res, 403, { error: "bad Host header" });
  if (!originAllowed(req)) return json(res, 403, { error: "cross-origin request refused" });

  const method = req.method;
  if (GET_ONLY.has(url.pathname) && method !== "GET") {
    return json(res, 405, { error: "GET required" });
  }
  if (POST_ONLY.has(url.pathname) && method !== "POST") {
    return json(res, 405, { error: "POST required" });
  }

  try {
    if (url.pathname === "/api/status") {
      const n = nousToken();
      const ct = collectorToken();
      const vb = voidBridgeToken();
      let models = 0;
      let modelError = null;
      if (n.ok) {
        const r = await fetch(`${n.baseUrl}/models`, {
          headers: { Authorization: `Bearer ${n.token}` },
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok) models = (await r.json()).data?.length ?? 0;
        else modelError = `HTTP ${r.status}`;
      }
      return json(res, 200, {
        nous: { ok: n.ok, expired: !!n.expired, expiresAt: n.expiresAt ?? null, models, error: modelError },
        collector: { url: c.collectorUrl, tokenAvailable: ct.ok },
        voidBridge: { url: c.voidBridgeUrl, tokenAvailable: vb.ok },
        models: { primary: c.model || null, fallback: c.fallbackModel, xai: c.xaiModel, google: c.googleModel },
        local: { ollamaBaseUrl: c.ollamaBaseUrl, ollamaModel: c.ollamaModel || null },
      });
    }

    if (url.pathname === "/api/memory") {
      const path = join(process.env.HOME, "Projects/lia-cli/data/memory/lia-memory.vault.json");
      try {
        const vault = JSON.parse(await readFile(path, "utf8"));
        const entries = Object.values(vault.entries || {});
        return json(res, 200, {
          total: entries.length,
          byVisibility: entries.reduce((a, e) => ((a[e.visibility] = (a[e.visibility] || 0) + 1), a), {}),
          tags: [...new Set(entries.flatMap((e) => e.tags || []))].sort(),
          entries: entries
            .filter((e) => e.visibility !== "encrypted")
            .map((e) => ({ id: e.id, at: e.timestamp, tags: e.tags, preview: String(e.content).slice(0, 160) }))
            .sort((a, b) => (a.at < b.at ? 1 : -1)),
        });
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }

    if (url.pathname === "/api/ideas") {
      const ct = collectorToken();
      if (!ct.ok) return json(res, 503, { error: ct.reason });
      const r = await fetch(`${c.collectorUrl}/ideas`, {
        headers: { Authorization: `Bearer ${ct.token}` },
        signal: AbortSignal.timeout(6000),
      });
      return json(res, r.status, await r.json().catch(() => ({})));
    }

    if (url.pathname === "/api/content") {
      const body = await readBody(req);
      if (!body) return json(res, 400, { error: "empty body" });
      let data;
      try { data = JSON.parse(body); } catch { return json(res, 400, { error: "invalid JSON" }); }
      const { prompt, context, model = "grok" } = data;
      if (typeof prompt !== "string" || !prompt.trim()) {
        return json(res, 400, { error: "prompt (non-empty string) required" });
      }
      const n = nousToken();
      if (!n.ok) return json(res, 503, { error: "nous token unavailable", reason: n.reason });
      const resp = await fetch(`${n.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${n.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "x-ai/grok-4.20",
          messages: [
            { role: "system", content: "You are Lia — a direct, warm, unsentimental voice. Short plain sentences, no filler; never 'Great question' or 'I'd be happy to'. You create content (posts, notes, drafts) grounded in the Lia memory vault." },
            ...(context ? [{ role: "user", content: context }] : []),
            { role: "user", content: prompt },
          ],
          max_tokens: 2048,
        }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        return json(res, resp.status, { error: `Grok request failed: ${resp.status} ${t.slice(0, 200)}` });
      }
      const data2 = await resp.json();
      const content = data2.choices?.[0]?.message?.content ?? "";
      return json(res, 200, { ok: true, content, model: "x-ai/grok-4.20", usage: data2.usage });
    }

    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (file.includes("..")) return json(res, 400, { error: "no" });
    const html = await readFile(join(here, file), "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
});

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj, null, 2));
}

server.listen(8788, "127.0.0.1", () => {
  console.log("lia console  http://127.0.0.1:8788");
});