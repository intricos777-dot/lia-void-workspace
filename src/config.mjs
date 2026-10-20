// Watermark: Living_Sin (intricos777-dot) + AI agents (Hermes, Lia, opencode) - collaborative work
// Resolves credentials and endpoints from files under $HOME.
// Nothing secret is ever read from this repo or written into it.

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const home = homedir();
const selfDir = dirname(fileURLToPath(import.meta.url));
// .env.example sits next to src/, wherever this repo is checked out.
const envExample = join(selfDir, "..", ".env.example");

function expand(p) {
  return p.replace(/%h/g, home).replace(/^~(?=\/|$)/, home);
}

function readEnvExample() {
  if (!existsSync(envExample)) return {};
  const out = {};
  for (const line of readFileSync(envExample, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

export function nousToken() {
  const raw = readEnvExample();
  const file = expand(raw.NOUS_TOKEN_FILE || join(home, ".hermes/shared/nous_auth.json"));
  if (!existsSync(file)) return { ok: false, reason: `no token file at ${file}` };
  try {
    const d = JSON.parse(readFileSync(file, "utf8"));
    if (!d.access_token) return { ok: false, reason: "token file has no access_token" };
    const expires = d.expires_at ? new Date(d.expires_at) : null;
    const expired = expires ? expires <= new Date() : false;
    return {
      ok: !expired,
      token: d.access_token,
      baseUrl: d.inference_base_url,
      expiresAt: d.expires_at,
      expired,
      remainingMs: expires ? expires - new Date() : null,
    };
  } catch (e) {
    return { ok: false, reason: `token file unreadable: ${e.message}` };
  }
}

export function collectorToken() {
  const raw = readEnvExample();
  const file = expand(raw.LIA_COLLECTOR_TOKEN_FILE || join(home, ".lia-cli/inbox/token"));
  if (!existsSync(file)) return { ok: false, reason: `no token file at ${file}` };
  return { ok: true, token: readFileSync(file, "utf8").trim() };
}

export function voidBridgeToken() {
  const file = join(home, ".config/void-bridge.env");
  if (!existsSync(file)) return { ok: false, reason: `no env file at ${file}` };
  const m = readFileSync(file, "utf8").match(/^VOID_BRIDGE_TOKEN=(\S+)/m);
  return m ? { ok: true, token: m[1] } : { ok: false, reason: "no VOID_BRIDGE_TOKEN in file" };
}

export function config() {
  const raw = readEnvExample();
  return {
    nousBaseUrl: raw.NOUS_INFERENCE_BASE_URL,
    portalBaseUrl: raw.NOUS_PORTAL_BASE_URL,
    model: raw.LIA_MODEL,
    fallbackModel: raw.LIA_FALLBACK_MODEL,
    xaiModel: raw.XAI_MODEL,
    googleModel: raw.GOOGLE_MODEL,
    ollamaBaseUrl: raw.OLLAMA_BASE_URL,
    ollamaModel: raw.OLLAMA_MODEL,
    collectorUrl: raw.LIA_COLLECTOR_URL,
    voidBridgeUrl: raw.VOID_BRIDGE_URL,
  };
}