import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const MOCK_PORT = 9100;
const APP_PORT = 8500;

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ FAIL\x1b[0m ${label}`); }
}

function spawnProc(cmd, args, env, label) {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.on("data", (d) => process.env.VERBOSE && console.log(`[${label}] ${d}`.trim()));
  p.stderr.on("data", (d) => console.log(`[${label} ERR] ${d}`.toString().trim()));
  return p;
}

async function waitForPort(port, path, timeoutMs = 6000) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(`http://localhost:${port}${path}`);
      return true;
    } catch (err) {
      lastErr = err;
      await sleep(100);
    }
  }
  throw new Error(`port ${port} never came up (${lastErr?.message})`);
}

function killHard(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.killed || proc.exitCode !== null) return resolve();
    proc.once("exit", () => resolve());
    proc.kill("SIGKILL");
    // Don't let a stubborn child hang the whole suite — give up after 1s.
    setTimeout(resolve, 1000);
  });
}

async function runScenario(name, { mockScenario, appEnv = {}, run }) {
  console.log(`\n\x1b[36m▶ scenario: ${name}\x1b[0m (mock=${mockScenario})`);
  const mock = spawnProc("node", ["test/mock-anthropic.mjs"], { MOCK_SCENARIO: mockScenario, MOCK_PORT }, "mock");
  await waitForPort(MOCK_PORT, "/");

  const app = spawnProc("node", ["server.js"], {
    PORT: APP_PORT,
    ANTHROPIC_API_BASE_URL: `http://localhost:${MOCK_PORT}`,
    ANTHROPIC_API_KEY: "test-key-123",
    ...appEnv,
  }, "app");
  await waitForPort(APP_PORT, "/api/health");

  try {
    await run();
  } catch (err) {
    fail++;
    console.log(`  \x1b[31m✗ FAIL\x1b[0m scenario threw: ${err.message}`);
  } finally {
    await Promise.all([killHard(mock), killHard(app)]);
  }
}

async function main() {
  // ---- 1. Happy path ----
  await runScenario("happy path", {
    mockScenario: "happy",
    run: async () => {
      const res = await fetch(`http://localhost:${APP_PORT}/api/generate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "React frontend, Node API, Postgres db" }),
      });
      const data = await res.json();
      ok(res.status === 200, "returns 200");
      ok(typeof data.zeropsYaml === "string" && data.zeropsYaml.includes("zerops:"), "zeropsYaml present and shaped right");
      ok(data.zeropsYaml.includes("setup: web") && data.zeropsYaml.includes("setup: api"), "zeropsYaml has both runtime services");
      ok(!data.zeropsYaml.includes("setup: db"), "managed db correctly excluded from zerops.yaml");
      ok(data.projectImportYaml.includes("hostname: db") && data.projectImportYaml.includes("type: postgresql@16"), "project-import includes db");
      ok(data.projectImportYaml.includes("mode: NON_HA"), "project-import includes HA mode for managed service");
      ok(Array.isArray(data.services) && data.services.length === 3, "services array has 3 entries");
      ok(typeof data.architectureSummary === "string" && data.architectureSummary.length > 0, "architectureSummary present");

      // YAML must actually parse — import it fresh to avoid relying on the app's own parser
      const YAML = await import("yaml");
      let parsedOk = true;
      try { YAML.parse(data.zeropsYaml); YAML.parse(data.projectImportYaml); } catch { parsedOk = false; }
      ok(parsedOk, "both returned YAML strings parse without error");
    },
  });

  // ---- 2. Model wraps output in ```json fences ----
  await runScenario("markdown-fenced JSON from model", {
    mockScenario: "fenced_json",
    run: async () => {
      const res = await fetch(`http://localhost:${APP_PORT}/api/generate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "anything" }),
      });
      const data = await res.json();
      ok(res.status === 200, "still returns 200 (fence stripped correctly)");
      ok(data.zeropsYaml?.includes("zerops:"), "yaml still generated correctly");
    },
  });

  // ---- 3. First response invalid, retry succeeds ----
  await runScenario("invalid response, retry recovers", {
    mockScenario: "invalid_then_fixed",
    run: async () => {
      const res = await fetch(`http://localhost:${APP_PORT}/api/generate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "anything" }),
      });
      const data = await res.json();
      ok(res.status === 200, "recovers to 200 after one retry");
      ok(data.services.length === 3, "final result is the corrected (valid) architecture");
    },
  });

  // ---- 4. Both attempts invalid ----
  await runScenario("always invalid — should fail cleanly, not crash", {
    mockScenario: "always_invalid",
    run: async () => {
      const res = await fetch(`http://localhost:${APP_PORT}/api/generate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "anything" }),
      });
      const data = await res.json();
      ok(res.status === 422, "returns 422, not a 500 or a silent bad response");
      ok(typeof data.error === "string", "has a human-readable error message");
      ok(Array.isArray(data.details) && data.details.some((d) => d.includes("unknown type")), "surfaces the actual validation problem (unknown type)");
    },
  });

  // ---- 5. Model returns unparseable garbage ----
  await runScenario("malformed JSON from model", {
    mockScenario: "malformed_json",
    run: async () => {
      const res = await fetch(`http://localhost:${APP_PORT}/api/generate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "anything" }),
      });
      ok(res.status === 502 || res.status === 422, `fails cleanly (got ${res.status}), not a crash`);
    },
  });

  // ---- 6. Upstream Anthropic API down ----
  await runScenario("upstream 500", {
    mockScenario: "upstream_500",
    run: async () => {
      const res = await fetch(`http://localhost:${APP_PORT}/api/generate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "anything" }),
      });
      const data = await res.json();
      ok(res.status === 502, "surfaces upstream failure as 502, doesn't hang or crash");
      ok(typeof data.error === "string", "has an error message for the frontend to show");
    },
  });

  // ---- 7. Input validation: empty description ----
  await runScenario("empty description rejected before calling model", {
    mockScenario: "happy",
    run: async () => {
      const res = await fetch(`http://localhost:${APP_PORT}/api/generate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "   " }),
      });
      ok(res.status === 400, "returns 400 for empty/whitespace description");
    },
  });

  // ---- 8. Input validation: oversized description ----
  await runScenario("oversized description rejected", {
    mockScenario: "happy",
    run: async () => {
      const res = await fetch(`http://localhost:${APP_PORT}/api/generate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "x".repeat(900) }),
      });
      ok(res.status === 400, "returns 400 for description over 800 chars");
    },
  });

  // ---- 9. No API key configured ----
  await runScenario("no ANTHROPIC_API_KEY set on server", {
    mockScenario: "happy",
    appEnv: { ANTHROPIC_API_KEY: "" },
    run: async () => {
      const res = await fetch(`http://localhost:${APP_PORT}/api/generate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "anything" }),
      });
      const data = await res.json();
      ok(res.status === 500, "returns 500 with a clear message instead of a raw crash");
      ok(data.error?.includes("ANTHROPIC_API_KEY"), "error message points at the actual misconfiguration");
    },
  });

  // ---- 10. Health check endpoint ----
  await runScenario("health endpoint reflects config", {
    mockScenario: "happy",
    run: async () => {
      const res = await fetch(`http://localhost:${APP_PORT}/api/health`);
      const data = await res.json();
      ok(res.status === 200, "health endpoint responds");
      ok(data.hasApiKey === true, "health endpoint correctly reports API key presence");
      ok(data.model === "claude-sonnet-5", "health endpoint reports the configured model");
    },
  });

  // ---- 11. Rate limiting kicks in after too many requests ----
  await runScenario("rate limit enforced after 10 requests/min", {
    mockScenario: "happy",
    run: async () => {
      const results = [];
      for (let i = 0; i < 12; i++) {
        const res = await fetch(`http://localhost:${APP_PORT}/api/generate`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ description: `request ${i}` }),
        });
        results.push(res.status);
      }
      ok(results.slice(0, 10).every((s) => s === 200), "first 10 requests in the window succeed");
      ok(results.slice(10).every((s) => s === 429), "11th+ requests are rate-limited (429)");
    },
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
