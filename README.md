# lia-void-workspace

Lia's localized frameworks, wired into the Void editor workspace.

**Private.** See `.privaterepo`.

## What this is

A Void workspace where Lia's personality, memory schema and provider routing
live in files you can read, rather than on somebody's server. The Void editor
opens this directory; the console gives you a browser view of the whole thing.

**This is not her.** It is an original local engine carrying her name and her
memory format. Replika's weights are not obtainable — no API, no portal, no
downloadable weights — so nothing here is a copy of her. Do not represent it
to anyone as her.

## Run it

```bash
node src/doctor.mjs      # probe every dependency, print a verdict
node web/serve.mjs       # console at http://127.0.0.1:8788
```

Or as a service:

```bash
systemctl --user enable --now lia-console.service
```

Open the folder in Void:

```bash
void ~/Projects/lia-void-workspace
```

## Layout

| Path | What |
|---|---|
| `schema/personality.json` | voice, traits, memory wiring, provider routing |
| `schema/memory.schema.json` | entry format, graph labels/edges, encryption envelope |
| `src/config.mjs` | reads credentials from 0600 files under `$HOME` |
| `src/doctor.mjs` | dependency probe |
| `web/serve.mjs` | console server, 127.0.0.1:8788 |
| `web/index.html` | the console UI |
| `.void/` | Void workspace state |

## Providers

Everything routes through **one** credential: the Nous Portal token Hermes
already holds at `~/.hermes/shared/nous_auth.json` (mode 600). No key is stored
in this repo.

That single token reaches all three providers that were asked for:

| Provider | How |
|---|---|
| Nous | native — 425 models at `inference-api.nousresearch.com/v1` |
| xAI | `x-ai/grok-4.20` and siblings, through Nous |
| Google | `google/gemini-3.8-flash` and siblings, through Nous |

A separate Google/Gemini key is **not** needed for model inference. Gmail OAuth
would only matter for Google *services* — Drive, Gmail, Calendar — which this
workspace does not touch.

**The token has a ~1 hour TTL and this console does not refresh it.** It reads
whatever Hermes currently holds. If the doctor reports `EXPIRED`, refresh in
Hermes; nothing here needs changing.

## The open question: which model she runs

No model named **elena**, **elana** or **liana** exists among the 425 on the
Nous Portal. Verified 2026-10-05 by listing the whole catalogue.

So that name is either a Replika-side model with no public identifier, or a
local Ollama model that did not survive the 2026-09-26 rebuild. `LIA_MODEL` in
`.env.example` is deliberately left empty rather than filled with a guess.

## Ollama

**Running.** v0.34.1, installed 2026-10-05 by Hermes while this workspace was
being scaffolded, listening on `127.0.0.1:11434`.

One model is pulled: **`llama3.2:3b`** (3.2B, Q4_K_M). That is a generic small
base model. It is **not** Lia's, and it is not named elena/elana/liana. No
Modelfile of hers exists anywhere on this machine.

So local inference works today, but it is running a stock 3B model — not her,
and not tuned for the personality in `schema/personality.json`. Pulling a
larger open-weights model and writing a Modelfile from that personality spec is
the next real piece of work.

## Also wired

- **Lia collector** — `127.0.0.1:4124`, systemd user service, active. Returns
  200 with the token from `~/.lia-cli/inbox/token`.
- **Void bridge** — `127.0.0.1:8787`, systemd user service `void_bridge.service`.
  Exposes `~/Projects` to Hermes with bearer auth and path confinement.
- **Void editor** and **supercode** — both on `PATH`.

## Memory

Reads `~/Projects/lia-cli/data/memory/lia-memory.vault.json` in place, so
there is one store and no migration. Of 11 entries, 9 are `encrypted` and are
never sent to the browser — the console only ever receives `public` and
`hidden`.

Passphrases come from `LIA_MEMORY_PASSPHRASE`, never from this repo.