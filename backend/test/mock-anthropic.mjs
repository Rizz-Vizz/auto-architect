import http from "node:http";

// Simulates api.anthropic.com/v1/messages just accurately enough to drive a
// real integration test of server.js: same response envelope shape
// (content: [{type:"text", text: "..."}]), and controllable behavior per
// scenario via the MOCK_SCENARIO env var, so we can exercise every branch
// server.js actually has to handle.

const SCENARIO = process.env.MOCK_SCENARIO || "happy";
const PORT = process.env.MOCK_PORT || 9100;

let callCount = 0;

const GOOD_RESPONSE = {
  architectureSummary: "A static frontend and a Node API talking to a managed Postgres database.",
  services: [
    {
      hostname: "web", role: "frontend", kind: "static", type: "static",
      description: "Static frontend.",
      build: { base: "nodejs@22", buildCommands: ["npm install", "npm run build"], deployFiles: ["dist/~"] },
      run: { base: "static", start: null, ports: [{ port: 80, httpSupport: true }], envVariables: {} },
      mode: null, enableSubdomainAccess: true, connectsTo: ["api"],
    },
    {
      hostname: "api", role: "api", kind: "runtime", type: "nodejs@22",
      description: "Node API.",
      build: { base: "nodejs@22", buildCommands: ["npm install"], deployFiles: ["server.js", "package.json", "node_modules"] },
      run: { base: "nodejs@22", start: "npm start", ports: [{ port: 3000, httpSupport: true }], envVariables: { DATABASE_URL: "${db_connectionString}" } },
      mode: null, enableSubdomainAccess: true, connectsTo: ["db"],
    },
    {
      hostname: "db", role: "database", kind: "managed", type: "postgresql@16",
      description: "Managed Postgres.",
      build: null, run: null, mode: "NON_HA", enableSubdomainAccess: false, connectsTo: [],
    },
  ],
};

// Deliberately broken: unknown type + missing ports, to test validation.
const INVALID_RESPONSE = {
  architectureSummary: "Bad output for testing.",
  services: [
    { hostname: "api", role: "api", kind: "runtime", type: "mongodb@8", run: { ports: [] }, connectsTo: [] },
  ],
};

function textEnvelope(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj) }] };
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || !req.url.includes("/v1/messages")) {
    res.writeHead(404); res.end(); return;
  }
  callCount++;

  // Read body just so the request is fully consumed (mirrors real HTTP behavior).
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const authHeader = req.headers["x-api-key"];

  res.setHeader("content-type", "application/json");

  switch (SCENARIO) {
    case "happy":
      res.writeHead(200);
      res.end(JSON.stringify(textEnvelope(GOOD_RESPONSE)));
      return;

    case "fenced_json": {
      // Model wraps JSON in ```json fences despite instructions — this DOES
      // happen with real models sometimes, and extractJson() should strip it.
      const fenced = { content: [{ type: "text", text: "```json\n" + JSON.stringify(GOOD_RESPONSE) + "\n```" }] };
      res.writeHead(200);
      res.end(JSON.stringify(fenced));
      return;
    }

    case "invalid_then_fixed":
      // First call: invalid (bad type, no ports). Second call (the retry):
      // valid. Tests the retry-with-feedback loop actually recovers.
      res.writeHead(200);
      res.end(JSON.stringify(textEnvelope(callCount === 1 ? INVALID_RESPONSE : GOOD_RESPONSE)));
      return;

    case "always_invalid":
      res.writeHead(200);
      res.end(JSON.stringify(textEnvelope(INVALID_RESPONSE)));
      return;

    case "malformed_json":
      res.writeHead(200);
      res.end(JSON.stringify({ content: [{ type: "text", text: "not valid json at all {{{" }] }));
      return;

    case "upstream_500":
      res.writeHead(500);
      res.end("internal server error");
      return;

    case "bad_auth":
      if (authHeader !== "test-key-123") {
        res.writeHead(401);
        res.end(JSON.stringify({ error: "invalid x-api-key" }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify(textEnvelope(GOOD_RESPONSE)));
      return;

    default:
      res.writeHead(500);
      res.end("unknown scenario");
  }
});

server.listen(PORT, () => {
  console.log(`mock-anthropic listening on :${PORT} (scenario: ${SCENARIO})`);
});
