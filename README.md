# Auto-Architect

Describe your app in plain English. Get a real `zerops.yaml`, a `zerops-project-import.yaml`, and a visual architecture diagram grounded in actual Zerops service types.

Built for the [Zerops Challenge](https://wemakedevs.org) (WeMakeDevs × Zerops).

---

## How it works

The model is never asked to write YAML directly — LLMs are unreliable at exact indentation and syntax. Instead:

1. It gets a system prompt with real Zerops syntax rules and few-shot examples sourced from [docs.zerops.io](https://docs.zerops.io)
2. It returns structured JSON — a list of services with hostname, type, build, and run fields
3. The backend validates that JSON. If invalid, it retries once with the specific errors fed back
4. Only after validation does `yamlBuilder.js` turn the JSON into YAML — deterministically, the same way every time

## Architecture

```
browser ──▶ web (static) ──▶ api (nodejs@22) ──▶ Groq API
```

Two Zerops services. No database — nothing to persist between requests.

## Project layout

```
auto-architect/
├── zerops-project-import.yaml   # creates both Zerops services in one shot
├── backend/
│   ├── server.js                # Express, /api/generate, rate limiting
│   ├── prompt.js                # system prompt builder
│   ├── yamlBuilder.js           # JSON → YAML
│   ├── zeropsKnowledge.js       # service types, syntax rules, few-shot examples
│   └── zerops.yaml
└── frontend/
    ├── index.html / style.css / app.js
    ├── config.js                # set your deployed API URL here
    └── zerops.yaml
```

## Run locally

```bash
cd backend
cp .env.example .env    # fill in GROQ_API_KEY
npm install
npm start               # :8000
```

Open `frontend/index.html` in a browser. It defaults to `localhost:8000`.

## Deploy to Zerops

1. **Import project** in the Zerops GUI → paste `zerops-project-import.yaml`
2. On the `api` service → Secret variables → add `GROQ_API_KEY`
3. Connect `api` → this repo's `/backend` subfolder
4. Connect `web` → this repo's `/frontend` subfolder
5. Once `api` is live, copy its public URL → put it in `frontend/config.js` → push

## AI disclosure

- Groq (Llama 3.3 70B) is the model powering the core feature at runtime
- Antigravity was used as a coding assistant during development
- Zerops syntax in `zeropsKnowledge.js` was pulled from docs.zerops.io and hand-verified
