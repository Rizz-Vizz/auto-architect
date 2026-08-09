import { JSDOM } from "jsdom";
import fs from "node:fs";

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ FAIL\x1b[0m ${label}`); }
}

function loadRealApp({ mockFetchImpl }) {
  const html = fs.readFileSync("./index.html", "utf8");
  const configJs = fs.readFileSync("./config.js", "utf8");
  const appJs = fs.readFileSync("./app.js", "utf8");

  // Inline the two script files so jsdom executes the actual, unmodified
  // source of both — no reimplementation, no mocking of our own logic.
  const inlined = html
    .replace('<script src="config.js"></script>', `<script>${configJs}</script>`)
    .replace('<script src="app.js"></script>', `<script>${appJs}</script>`);

  const dom = new JSDOM(inlined, {
    runScripts: "outside-only", // we control exactly when scripts run
    resources: "usable",
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  const { window } = dom;

  // Minimal browser APIs jsdom doesn't ship that app.js touches.
  window.navigator.clipboard = { writeText: async () => {} };
  window.fetch = mockFetchImpl;

  // Run the inlined <script> tags now that fetch/clipboard exist.
  const scripts = [...window.document.querySelectorAll("script:not([src])")];
  scripts.forEach((s) => window.eval(s.textContent));

  return window;
}

async function flush() {
  // Let pending microtasks/timers in jsdom's event loop settle.
  await new Promise((r) => setTimeout(r, 50));
}

async function main() {
  // ---- Test 1: page loads, empty state shown, no JS errors ----
  console.log("\n\x1b[36m▶ initial load\x1b[0m");
  {
    const window = loadRealApp({ mockFetchImpl: async () => { throw new Error("should not be called yet"); } });
    const d = window.document;
    ok(d.getElementById("emptyState").hidden === false, "empty state visible on load");
    ok(d.getElementById("resultState").hidden === true, "result state hidden on load");
    ok(d.getElementById("loadingState").hidden === true, "loading state hidden on load");
    ok(d.querySelectorAll(".chip").length === 3, "3 example chips rendered");
    ok(d.getElementById("apiUrlLabel").textContent === "http://localhost:8000", "API URL label shows config.js default");
    window.close();
  }

  // ---- Test 2: example chip fills textarea ----
  console.log("\n\x1b[36m▶ example chip click\x1b[0m");
  {
    const window = loadRealApp({ mockFetchImpl: async () => { throw new Error("unused"); } });
    const d = window.document;
    const chip = d.querySelector(".chip");
    chip.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    ok(d.getElementById("description").value === chip.dataset.example, "textarea filled with chip's example text");
    ok(d.getElementById("charCount").textContent === String(chip.dataset.example.length), "char counter updated");
    window.close();
  }

  // ---- Test 3: empty description shows inline error, does not call fetch ----
  console.log("\n\x1b[36m▶ generate with empty description\x1b[0m");
  {
    let fetchCalled = false;
    const window = loadRealApp({ mockFetchImpl: async () => { fetchCalled = true; } });
    const d = window.document;
    d.getElementById("generateBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flush();
    ok(!fetchCalled, "fetch not called for empty description");
    ok(d.getElementById("errorBox").hidden === false, "error box shown");
    ok(d.getElementById("errorBox").textContent.includes("Describe"), "error message is the right one");
    window.close();
  }

  // ---- Test 4: full happy-path generate flow renders real result into the DOM ----
  console.log("\n\x1b[36m▶ full generate flow (mocked backend response)\x1b[0m");
  {
    const backendResponse = {
      architectureSummary: "A test summary of the architecture.",
      services: [
        { hostname: "web", role: "frontend", kind: "static", type: "static", connectsTo: ["api"] },
        { hostname: "api", role: "api", kind: "runtime", type: "nodejs@22", connectsTo: ["db"] },
        { hostname: "db", role: "database", kind: "managed", type: "postgresql@16", connectsTo: [] },
      ],
      zeropsYaml: "zerops:\n  - setup: web\n",
      projectImportYaml: "project:\n  name: test\n",
    };
    let capturedUrl, capturedBody;
    const window = loadRealApp({
      mockFetchImpl: async (url, opts) => {
        capturedUrl = url;
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => backendResponse };
      },
    });
    const d = window.document;
    d.getElementById("description").value = "React frontend, Node API, Postgres db";
    d.getElementById("generateBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    await flush();

    ok(capturedUrl === "http://localhost:8000/api/generate", "fetch called with correct URL (from config.js default)");
    ok(capturedBody.description === "React frontend, Node API, Postgres db", "request body carries the typed description");
    ok(d.getElementById("resultState").hidden === false, "result state shown after successful response");
    ok(d.getElementById("emptyState").hidden === true, "empty state hidden after result");
    ok(d.getElementById("architectureSummary").textContent === backendResponse.architectureSummary, "summary text rendered exactly as returned");
    ok(d.getElementById("zeropsYamlCode").textContent === backendResponse.zeropsYaml, "zerops.yaml tab populated with real returned YAML");
    ok(d.getElementById("importYamlCode").textContent === backendResponse.projectImportYaml, "project-import tab populated");

    const svg = d.querySelector("#diagramMount svg");
    ok(svg !== null, "diagram SVG actually rendered into the DOM");
    ok(d.querySelectorAll("#diagramMount rect").length === 3, "diagram has one node per service (3)");
    ok(d.getElementById("errorBox").hidden === true, "no error shown on success");
    window.close();
  }

  // ---- Test 5: tab switching shows/hides the right views ----
  console.log("\n\x1b[36m▶ tab switching\x1b[0m");
  {
    const backendResponse = {
      architectureSummary: "x", services: [{ hostname: "a", role: "api", kind: "runtime", type: "nodejs@22", connectsTo: [] }],
      zeropsYaml: "zerops:\n  - setup: a\n", projectImportYaml: "project:\n  name: x\n",
    };
    const window = loadRealApp({ mockFetchImpl: async () => ({ ok: true, status: 200, json: async () => backendResponse }) });
    const d = window.document;
    d.getElementById("description").value = "anything";
    d.getElementById("generateBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flush();

    const zeropsTab = [...d.querySelectorAll(".tab")].find((t) => t.dataset.tab === "zerops");
    zeropsTab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    ok(d.getElementById("blueprintView").hidden === true, "blueprint view hidden after switching tab");
    ok(d.getElementById("zeropsView").hidden === false, "zerops.yaml view shown after clicking its tab");
    ok(zeropsTab.classList.contains("active"), "clicked tab gets active class");
    ok(zeropsTab.getAttribute("aria-selected") === "true", "aria-selected updated for a11y");
    window.close();
  }

  // ---- Test 6: backend error response shown to user, doesn't crash ----
  console.log("\n\x1b[36m▶ backend error response\x1b[0m");
  {
    const window = loadRealApp({
      mockFetchImpl: async () => ({ ok: false, status: 422, json: async () => ({ error: "Couldn't produce a valid architecture." }) }),
    });
    const d = window.document;
    d.getElementById("description").value = "anything";
    d.getElementById("generateBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flush();

    ok(d.getElementById("errorBox").hidden === false, "error box shown on backend error");
    ok(d.getElementById("errorBox").textContent === "Couldn't produce a valid architecture.", "shows the backend's actual error message");
    ok(d.getElementById("resultState").hidden === true, "result state stays hidden on error");
    ok(d.getElementById("generateBtn").disabled === false, "generate button re-enabled after error (not stuck disabled)");
    window.close();
  }

  // ---- Test 7: network failure (fetch throws) handled gracefully ----
  console.log("\n\x1b[36m▶ network failure\x1b[0m");
  {
    const window = loadRealApp({ mockFetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
    const d = window.document;
    d.getElementById("description").value = "anything";
    d.getElementById("generateBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flush();

    ok(d.getElementById("errorBox").hidden === false, "error shown on network failure");
    ok(d.getElementById("errorBox").textContent.includes("Can't reach the backend"), "shows the specific 'can't reach backend' message, not a raw exception");
    window.close();
  }

  // ---- Test 8: API settings persists to localStorage and updates label ----
  console.log("\n\x1b[36m▶ API settings override\x1b[0m");
  {
    const window = loadRealApp({ mockFetchImpl: async () => { throw new Error("unused"); } });
    window.prompt = () => "https://api-example.prg1.zerops.app";
    const d = window.document;
    d.getElementById("apiSettingsBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    ok(d.getElementById("apiUrlLabel").textContent === "https://api-example.prg1.zerops.app", "label updates after setting custom API URL");
    ok(window.localStorage.getItem("autoArchitect.apiBaseUrl") === "https://api-example.prg1.zerops.app", "persisted to localStorage for future visits");
    window.close();
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error("Frontend test runner crashed:", err);
  process.exitCode = 1;
});
