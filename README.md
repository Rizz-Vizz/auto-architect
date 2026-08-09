# Auto-Architect

Type a plain-English description of an app. Get back a real, working
`zerops.yaml`, a `zerops-project-import.yaml`, and a visual node map of the
architecture — grounded in actual Zerops service types and syntax, not the
model's best guess.

Built for the [Zerops Challenge](https://wemakedevs.org) (WeMakeDevs × Zerops).
Powered by [Groq](https://groq.com) (Llama 3.3 70B) — free, no credit card required.

---

## Why it's built this way

The one thing that would sink this tool is a confidently wrong `zerops.yaml`.
So the LLM is **never** asked to write YAML directly. Instead:

1. The model receives a system prompt containing the real Zerops syntax rules,
   a table of known runtime/managed service types, and two full worked
   examples (see `backend/zeropsKnowledge.js` — sourced from
   [docs.zerops.io](https://docs.zerops.io)).
2. The model returns **structured JSON only** (a list of services with
   hostname/type/build/run fields) — never free-form YAML.
3. The backend validates that JSON against the known service-type list and a
   handful of structural rules (`server.js` → `validateParsed`). If it's
   invalid, the backend retries once with the specific errors fed back to
   the model.
4. Only after validation does deterministic code (`yamlBuilder.js`) turn the
   JSON into YAML text — the same way, every time, with no room for the
   model to typo an indentation level.
5. The backend parses its own generated YAML as a final sanity check before
   returning it.

This is also why the architecture stayed to two services: the LLM call is
the single riskiest dependency in the whole project, so everything else
was kept as simple as possible to leave room for that to be solid.

## Architecture (of this project itself)

```
 browser ──public──▶  web (static)  ──public──▶  api (nodejs@22)  ──▶  Anthropic API
                     (frontend/)                  (backend/)
```

Two services, no database — there's nothing here that needs to persist
between requests. `web` is a plain static site (no build step). `api` is a
small Express server with one real endpoint, `POST /api/generate`.

## Project layout

```
auto-architect/
├── zerops-project-import.yaml   # one-shot: creates both Zerops services
├── backend/
│   ├── server.js                # Express app, /api/generate endpoint, rate limiting
│   ├── prompt.js                # assembles the system prompt
│   ├── yamlBuilder.js           # JSON -> YAML, deterministic
│   ├── zeropsKnowledge.js       # grounding data (types, syntax, few-shot)
│   ├── zerops.yaml              # this service's own build/deploy config
│   ├── test/
│   │   ├── mock-anthropic.mjs   # stand-in Anthropic API for testing
│   │   └── integration.test.mjs # 28 assertions against the real server.js
│   └── .env.example
└── frontend/
    ├── index.html / style.css / app.js
    ├── config.js                 # <- point this at your deployed API
    ├── zerops.yaml
    └── test/
        └── dom.test.mjs          # 32 assertions against the real frontend files
```

## Run it locally

**Backend:**
```bash
cd backend
cp .env.example .env       # add your GROQ_API_KEY (free at console.groq.com)
npm install
npm start                  # listens on :8000
```

**Frontend:** `frontend/config.js` already defaults to `http://localhost:8000`,
so just open `frontend/index.html` in a browser (or serve the folder with
any static server, e.g. `npx serve frontend`).

**Run the test suites:**
```bash
cd backend && npm install && npm test    # 28 assertions, ~15s
cd frontend && npm install && npm test   # 32 assertions, ~2s
```

## What's actually been tested

Everything below was run for real in a sandboxed environment — not asserted,
executed. Full commands: `cd backend && npm test` (28 assertions) and
`cd frontend && npm test` (32 assertions).

**Backend (`backend/test/integration.test.mjs`):** a mock Anthropic API
server (`test/mock-anthropic.mjs`) stands in for `api.anthropic.com`, and
the *real* `server.js` is started against it and driven with real HTTP
requests. Covers: the happy path end-to-end (including that both returned
YAML strings actually parse); a model response wrapped in ` ```json ` fences
gets cleaned up correctly; an invalid first response triggers the
retry-with-feedback loop and recovers; two invalid responses in a row fail
as a clean `422` with the specific validation errors, not a crash; unparsable
model output fails as a clean `502`; an upstream `500` from Anthropic is
handled without hanging; empty/oversized descriptions are rejected before
ever calling the model; a missing `ANTHROPIC_API_KEY` fails clearly instead
of throwing; and the per-IP rate limiter (10 req/min) actually kicks in on
the 11th request.

**Frontend (`frontend/test/dom.test.mjs`):** the actual `index.html`,
`app.js`, and `config.js` — unmodified — are loaded into a real DOM
(jsdom) and driven the way a person would: clicking example chips, clicking
Generate, switching tabs, hitting the API-settings prompt. `fetch` is
mocked at the network boundary only, so every line of app logic in between
is real. Covers: initial state, the empty-description guard rail, a full
successful generate flow (checks the diagram actually rendered 3 `<rect>`
nodes, both YAML tabs contain exactly what the backend returned, the
summary text matches), tab switching, a backend error response rendering
correctly, a network failure showing the right message instead of a raw
exception, and the API-URL override persisting to `localStorage`.

**Also checked separately:** `style.css` parses with zero syntax errors
(`css-tree`); every single `var(--x)` reference anywhere in the project —
including inside the JS-generated SVG — has a matching definition (this
would've caught a diagram silently rendering broken colors); `index.html`
passes `html-validate` with zero errors; the diagram layout algorithm was
rendered to actual PNGs (not just DOM-checked) for a 6-service 3-column
case and a 1-service edge case, both look correct; every text/background
color pairing in the palette was checked against WCAG AA contrast — this
caught and fixed one real failure (`--text-faint` was 2.84:1, now 4.53:1).

## What's still unverified — you need to check these

- **The actual Claude API call.** Everything above tests the code *around*
  the model call. Nothing here can substitute for running it with a real
  `ANTHROPIC_API_KEY` and looking at output for 5-10 different app
  descriptions — that's the one part of this whole pipeline I couldn't
  exercise, and it's the part your demo depends on most.
- **Actual deployment to Zerops.** The YAML is grounded in real docs and
  parses correctly, but I couldn't create a Zerops account or deploy from
  this environment. Budget real time for this — something will likely need
  a small fix on first deploy, it always does.
- **Visual appearance in a real browser.** I don't have a working headless
  browser in this environment, so CSS layout (grid breakpoints, flexbox,
  hover states) was checked structurally (valid CSS, no missing variables,
  contrast ratios) but never actually painted. Open `index.html` yourself
  before you record a demo.



## Deploy to Zerops

1. Push this repo to GitHub.
2. In the Zerops GUI: **Import project** → paste the contents of
   `zerops-project-import.yaml`. This creates two empty services, `web` and
   `api`.
3. Connect `web` to your repo's `/frontend` subfolder, and `api` to
   `/backend`, via each service's **Deployment** tab (or use zCLI / the
   GitHub integration — either triggers the `zerops.yaml` already sitting in
   each subfolder).
4. On the `api` service: **Environment variables → Secret variables** → add
   `ANTHROPIC_API_KEY`.
5. Once `api` is deployed, copy its public subdomain from **IP addresses &
   Public Routing** (looks like `https://api-xxxx-8000.prg1.zerops.app`).
6. Open the deployed `web` app, click **API endpoint** at the bottom of the
   input panel, and paste that URL in. It's saved in the browser and reused
   on every visit — no rebuild needed if the API URL ever changes.

## AI-use disclosure (for the hackathon submission)

- **Groq API** (Llama 3.3 70B) is used **at runtime**, as the product's core
  feature — parsing the user's free-text description into structured
  architecture JSON.
- An AI coding assistant (Antigravity) was used to help scaffold and debug
  this codebase during the hackathon.
- The Zerops syntax rules and examples in `zeropsKnowledge.js` were pulled
  from docs.zerops.io and hand-verified, not generated from memory — this is
  the part accuracy depends on most, so it's worth rereading against the
  docs before you submit.

## Known limitations / places to harden if you have time left

- The known-types list in `zeropsKnowledge.js` covers the common runtimes
  and managed services, not the full Zerops catalog (e.g. object storage
  isn't modeled yet — it doesn't map cleanly onto the "service" shape the
  JSON schema uses).
- No persistence — every generation is a fresh request, nothing is saved.
  Would be a natural place to add a `db` service and a "recent architectures"
  list if you want to extend it.
- No rate limiting on `/api/generate` — fine for a demo, not for prod.
