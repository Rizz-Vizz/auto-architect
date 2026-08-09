import "dotenv/config";
import express from "express";
import cors from "cors";
import YAML from "yaml";
import { buildSystemPrompt } from "./prompt.js";
import { buildYamlOutputs } from "./yamlBuilder.js";
import { RUNTIME_TYPES, MANAGED_TYPES } from "./zeropsKnowledge.js";

const PORT = process.env.PORT || 8000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_API_BASE_URL = "https://api.groq.com/openai/v1";
const KNOWN_TYPES = new Set([...Object.keys(RUNTIME_TYPES), ...Object.keys(MANAGED_TYPES)]);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, hasApiKey: Boolean(GROQ_API_KEY), model: MODEL });
});

// Simple in-memory fixed-window rate limiter, per IP. No extra dependency —
// this is a demo/hackathon backend behind one shared API key, not a
// multi-tenant service, so this is deliberately just enough to stop a
// runaway loop or an accidental refresh-spam from burning through credits,
// not a production-grade limiter (resets on restart, doesn't share state
// across instances).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const hits = new Map(); // ip -> { count, windowStart }

function rateLimit(req, res, next) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    return next();
  }

  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    const retryAfterSec = Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    res.setHeader("Retry-After", String(retryAfterSec));
    return res.status(429).json({ error: `Too many requests. Try again in ${retryAfterSec}s.` });
  }
  next();
}

// Occasionally sweep stale entries so this Map doesn't grow unbounded on a
// long-running instance.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) hits.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

// Strips ```json fences if the model adds them despite being told not to.
function extractJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenced ? fenced[1].trim() : trimmed;
}

// Cheap structural validation so a malformed model response never reaches
// the YAML builder (and never reaches the user as broken output).
function validateParsed(parsed) {
  const errors = [];
  if (!parsed || typeof parsed !== "object") return ["response is not an object"];
  if (!Array.isArray(parsed.services) || parsed.services.length === 0) {
    errors.push("missing or empty `services` array");
    return errors;
  }
  const hostnames = new Set();
  for (const s of parsed.services) {
    if (!s.hostname || typeof s.hostname !== "string") errors.push("a service is missing `hostname`");
    else if (hostnames.has(s.hostname)) errors.push(`duplicate hostname "${s.hostname}"`);
    else hostnames.add(s.hostname);

    if (!s.type || !KNOWN_TYPES.has(s.type)) errors.push(`service "${s.hostname}" has unknown type "${s.type}"`);
    if (!["static", "runtime", "managed"].includes(s.kind)) errors.push(`service "${s.hostname}" has invalid kind "${s.kind}"`);
    if (s.kind === "managed" && !["NON_HA", "HA"].includes(s.mode)) errors.push(`managed service "${s.hostname}" needs mode NON_HA or HA`);
    if (s.kind !== "managed" && (!s.run || !s.run.ports || !s.run.ports.length)) {
      errors.push(`service "${s.hostname}" is missing run.ports`);
    }
  }
  return errors;
}

async function callClaude(description, { retryHint } = {}) {
  if (!GROQ_API_KEY) {
    const err = new Error("GROQ_API_KEY is not set on the server");
    err.code = "NO_API_KEY";
    throw err;
  }

  const userMessage = retryHint
    ? `App description: "${description}"\n\nYour previous response was invalid: ${retryHint}\nReturn corrected, valid JSON only.`
    : `App description: "${description}"`;

  const response = await fetch(`${GROQ_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      temperature: 0.2,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const err = new Error(`Groq API error ${response.status}: ${body.slice(0, 300)}`);
    err.code = "UPSTREAM_ERROR";
    throw err;
  }

  const data = await response.json();
  const textBlock = data.choices?.[0]?.message?.content;
  if (!textBlock) {
    const err = new Error("Model returned no text content");
    err.code = "EMPTY_RESPONSE";
    throw err;
  }

  const jsonText = extractJson(textBlock);
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const err = new Error("Model response was not valid JSON");
    err.code = "BAD_JSON";
    err.raw = jsonText;
    throw err;
  }
  return parsed;
}

app.post("/api/generate", rateLimit, async (req, res) => {
  const description = (req.body?.description || "").trim();
  if (!description) {
    return res.status(400).json({ error: "Please describe the app you want to build." });
  }
  if (description.length > 800) {
    return res.status(400).json({ error: "Keep the description under 800 characters." });
  }

  try {
    let parsed = await callClaude(description);
    let errors = validateParsed(parsed);

    // One retry with the specific validation errors fed back in — this is
    // the safety net for the single riskiest part of the pipeline.
    if (errors.length) {
      parsed = await callClaude(description, { retryHint: errors.join("; ") });
      errors = validateParsed(parsed);
    }

    if (errors.length) {
      return res.status(422).json({
        error: "Couldn't produce a valid architecture for that description. Try rephrasing it, or simplifying it.",
        details: errors,
      });
    }

    const { zeropsYaml, projectImportYaml } = buildYamlOutputs(parsed);

    // Final sanity check: make sure what we're about to send back actually
    // parses as YAML. If this ever fails it's a bug in yamlBuilder.js, not
    // the model's fault — better to surface it than ship broken output.
    YAML.parse(zeropsYaml);
    YAML.parse(projectImportYaml);

    res.json({
      architectureSummary: parsed.architectureSummary,
      services: parsed.services,
      zeropsYaml,
      projectImportYaml,
    });
  } catch (err) {
    console.error(err);
    if (err.code === "NO_API_KEY") {
      return res.status(500).json({ error: "Server isn't configured with a GROQ_API_KEY yet." });
    }
    res.status(502).json({ error: "The architecture generator is temporarily unavailable. Please try again." });
  }
});

app.listen(PORT, () => {
  console.log(`Auto-Architect backend listening on :${PORT} (model: ${MODEL})`);
});
