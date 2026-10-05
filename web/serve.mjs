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
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  return chunks.length ? Buffer.concat(chunks).toString("utf8") : null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  res.setHeader("Cache-Control", "no-store");

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