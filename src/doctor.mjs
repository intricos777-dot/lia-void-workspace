// Watermark: Living_Sin (intricos777-dot) + AI agents (Hermes, Lia, opencode) - collaborative work
// Probes every dependency and prints a verdict. Read-only.
//   node src/doctor.mjs

import { existsSync } from "node:fs";
import { config, nousToken, collectorToken, voidBridgeToken } from "./config.mjs";

const rows = [];
const add = (name, state, detail) => rows.push({ name, state, detail });

async function tcp(host, port) {
  try {
    const r = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(2500) });
    return { reachable: true, status: r.status };
  } catch (e) {
    const msg = String(e.cause?.code || e.message);
    return { reachable: msg.includes("ECONNREFUSED") ? false : null, msg };
  }
}

const c = config();

// Nous
const n = nousToken();
if (!n.ok) add("nous token", "MISSING", n.reason);
else if (n.expired) add("nous token", "EXPIRED", `expired ${n.expiresAt}`);
else {
  const mins = Math.round(n.remainingMs / 60000);
  add("nous token", mins < 10 ? "EXPIRING" : "OK", `${mins} min left, ${n.baseUrl}`);
  try {
    const r = await fetch(`${n.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${n.token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (r.ok) {
      const { data = [] } = await r.json();
      const has = (id) => data.some((m) => m.id === id);
      add("nous /models", "OK", `${data.length} models reachable`);
      for (const [label, id] of [["xAI via nous", c.xaiModel], ["google via nous", c.googleModel]]) {
        if (!id) { add(label, "UNSET", "no model id in .env.example"); continue; }
        add(label, has(id) ? "OK" : "ABSENT", id);
      }
      const named = data.filter((m) => /elena|elana|liana/i.test(m.id));
      add("elena/elana/liana", named.length ? "FOUND" : "NOT FOUND",
        named.length ? named.map((m) => m.id).join(", ") : "no such model on the portal");
    } else {
      add("nous /models", "FAIL", `HTTP ${r.status}`);
    }
  } catch (e) {
    add("nous /models", "FAIL", e.message);
  }
}

// Lia collector
const ct = collectorToken();
const host = new URL(c.collectorUrl).hostname;
const port = Number(new URL(c.collectorUrl).port);
const tcpC = await tcp(host, port);
if (tcpC.reachable === false) add("lia collector", "DOWN", `${c.collectorUrl} refused`);
else if (tcpC.reachable) {
  try {
    const r = await fetch(`${c.collectorUrl}/ideas`, {
      headers: ct.ok ? { Authorization: `Bearer ${ct.token}` } : {},
      signal: AbortSignal.timeout(4000),
    });
    add("lia collector", r.ok ? "OK" : "AUTH", ct.ok ? `HTTP ${r.status}` : "no token file");
  } catch (e) {
    add("lia collector", "FAIL", e.message);
  }
} else add("lia collector", "UNKNOWN", tcpC.msg || "");

// Void bridge
const vb = voidBridgeToken();
const vbUrl = new URL(c.voidBridgeUrl);
const tcpV = await tcp(vbUrl.hostname, Number(vbUrl.port));
if (tcpV.reachable === false) add("void bridge", "DOWN", `${c.voidBridgeUrl} refused`);
else if (vb.ok) {
  try {
    const r = await fetch(`${c.voidBridgeUrl}/health`, {
      headers: { Authorization: `Bearer ${vb.token}` },
      signal: AbortSignal.timeout(4000),
    });
    const j = await r.json();
    add("void bridge", j.ok ? "OK" : "FAIL", `root ${j.root}`);
  } catch (e) {
    add("void bridge", "FAIL", e.message);
  }
} else add("void bridge", "NO TOKEN", vb.reason);

// Ollama — verify models, not just the port
const oBase = c.ollamaBaseUrl;
try {
  const r = await fetch(`${oBase}/api/tags`, { signal: AbortSignal.timeout(4000) });
  if (r.ok) {
    const { models = [] } = await r.json();
    add("ollama", models.length ? "OK" : "NO MODELS", oBase);
    add("ollama models", models.length ? "OK" : "ABSENT",
      models.map((m) => {
        const d = m.details || {};
        return `${m.name}${d.parameter_size ? ` (${d.parameter_size} ${d.quantization_level || ""})` : ""}`;
      }).join(", ") || "none pulled — ollama serve is up but empty");
    const wanted = c.ollamaModel;
    if (wanted) {
      const hit = models.find((m) => m.name === wanted || m.name.startsWith(`${wanted.split(":")[0]}:`));
      add("ollama target", hit ? "OK" : "ABSENT", wanted);
    }
  } else {
    add("ollama", "FAIL", `HTTP ${r.status}`);
  }
} catch {
  add("ollama", "ABSENT", `not listening on ${new URL(oBase).port}`);
}

// Void editor binary
const voidBin = `${process.env.HOME}/.local/bin/void`;
const supBin = `${process.env.HOME}/.local/bin/supercode`;
add("void editor", existsSync(voidBin) ? "OK" : "MISSING", voidBin);
add("supercode", existsSync(supBin) ? "OK" : "MISSING", supBin);

const pad = (s, n) => String(s).padEnd(n);
console.log("");
console.log(`  lia-void-workspace doctor — ${new Date().toISOString()}`);
console.log("");
for (const r of rows) console.log(`  ${pad(r.state, 10)} ${pad(r.name, 22)} ${r.detail}`);
console.log("");
const bad = rows.filter((r) => ["MISSING", "FAIL", "DOWN", "EXPIRED", "AUTH", "UNKNOWN", "NO TOKEN"].includes(r.state));
console.log(bad.length
  ? `  ${bad.length} of ${rows.length} need attention.`
  : `  all ${rows.length} dependencies healthy.`);
console.log("");