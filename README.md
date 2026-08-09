# Auto-Architect

Describe your app in plain English. Get a real `zerops.yaml`, a `zerops-project-import.yaml`, and a visual architecture diagram — grounded in actual Zerops service types.

Built for the [Zerops Challenge](https://wemakedevs.org) (WeMakeDevs × Zerops). Powered by [Groq](https://console.groq.com) (Llama 3.3 70B) — free, no credit card required.

---

## How it works

The LLM is **never** asked to write YAML directly (LLMs are bad at exact indentation). Instead:

1. The model gets a system prompt with real Zerops syntax rules + few-shot examples sourced from [docs.zerops.io](https://docs.zerops.io)
2. It returns **structured JSON only** — a list of services with hostname/type/build/run fields
3. The backend validates that JSON. If invalid, it retries once with the specific errors fed back
4. Only after validation does deterministic code (`yamlBuilder.js`) build the YAML — same output every time

## Architecture

```
browser ──▶ web (static) ──▶ api (nodejs@22) ──▶ Groq API
```

Two Zerops services. No database — nothing to persist between requests.

## Project layout

```
auto-architect/
├── zerops-project-import.yaml   # one-shot: creates both Zerops services
├── backend/
│   ├── server.js                # Express, /api/generate, rate limiting
│   ├── prompt.js                # system prompt builder
│   ├── yamlBuilder.js           # JSON → YAML, deterministic
│   ├── zeropsKnowledge.js       # grounding data: types, syntax, few-shot examples
│   └── zerops.yaml
└── frontend/
    ├── index.html / style.css / app.js
    ├── config.js                # point this at your deployed API
    └── zerops.yaml
```

## Run locally

**Backend:**
```bash
cd backend
cp .env.example .env    # add your GROQ_API_KEY (free at console.groq.com)
npm install
npm start               # listens on :8000
```

**Frontend:** open `frontend/index.html` in a browser. It defaults to `http://localhost:8000`.

## Deploy to Zerops

1. In the Zerops GUI → **Import project** → paste `zerops-project-import.yaml`
2. On the `api` service → **Secret variables** → add `GROQ_API_KEY`
3. Connect `api` service to this repo's `/backend` subfolder
4. Connect `web` service to this repo's `/frontend` subfolder
5. Once `api` is live, copy its public URL → update `frontend/config.js` → push → done

## AI disclosure

- **Groq API** (Llama 3.3 70B) powers the core feature at runtime
- **Antigravity** (AI coding assistant) was used during development
- Zerops syntax rules in `zeropsKnowledge.js` were sourced from docs.zerops.io and hand-verified
