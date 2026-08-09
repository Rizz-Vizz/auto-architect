# Auto-Architect

Describe your app in plain English. Get a real `zerops.yaml`, a `zerops-project-import.yaml`, and a visual architecture diagram grounded in actual Zerops service types.

Built for the [Zerops Challenge](https://wemakedevs.org) (WeMakeDevs × Zerops).

[![Auto-Architect Demo](https://img.youtube.com/vi/rJyGQQ1k2Rw/maxresdefault.jpg)](https://www.youtube.com/watch?v=rJyGQQ1k2Rw)

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

##  Zerops Challenge Details

This project is submitted for the **WeMakeDevs x Zerops Challenge**. 

**1. How Zerops is used (Rule 9)**
The application is entirely hosted and deployed on Zerops using a decoupled architecture:
- **`web`**: A static frontend service built with HTML/CSS/JS and served by Nginx.
- **`api`**: A Node.js runtime service running an Express backend. 

Zerops CI/CD pipelines automatically build and deploy both services from this repository. The `zerops.yaml` file at the root defines the build steps and routing for both services in production.

**2. Architecture Complexity (Rule 5)**
This is a production-ready application, not a Hello World. It features a custom Express backend with an in-memory rate limiter, robust JSON validation to prevent LLM hallucinations, and deterministic YAML generation. The static frontend and Node.js backend are decoupled and communicate securely over the internet via Zerops subdomains.

**3. AI Tools Disclosure (Rule 12)**
- **Runtime AI**: The core text-to-architecture generation feature is powered by the Groq API (Llama 3.3 70B).
- **Development AI**: Google Gemini was used as a coding assistant to help build, debug, and configure the deployment pipelines during the hackathon. All core logic, prompts, and architecture decisions are original.
