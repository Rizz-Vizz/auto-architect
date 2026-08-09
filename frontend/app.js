(() => {
  "use strict";

  const STORAGE_KEY = "autoArchitect.apiBaseUrl";

  function getApiBaseUrl() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("api");
    if (fromQuery) {
      localStorage.setItem(STORAGE_KEY, fromQuery);
      return fromQuery;
    }
    return (
      localStorage.getItem(STORAGE_KEY) ||
      window.AUTO_ARCHITECT_CONFIG?.DEFAULT_API_BASE_URL ||
      "http://localhost:8000"
    );
  }

  function setApiBaseUrl(url) {
    localStorage.setItem(STORAGE_KEY, url);
    refreshApiLabel();
  }

  function refreshApiLabel() {
    document.getElementById("apiUrlLabel").textContent = getApiBaseUrl();
  }

  // ---------- DOM refs ----------
  const el = {
    description: document.getElementById("description"),
    charCount: document.getElementById("charCount"),
    generateBtn: document.getElementById("generateBtn"),
    errorBox: document.getElementById("errorBox"),
    emptyState: document.getElementById("emptyState"),
    loadingState: document.getElementById("loadingState"),
    loadingText: document.getElementById("loadingText"),
    resultState: document.getElementById("resultState"),
    architectureSummary: document.getElementById("architectureSummary"),
    diagramMount: document.getElementById("diagramMount"),
    zeropsYamlCode: document.getElementById("zeropsYamlCode"),
    importYamlCode: document.getElementById("importYamlCode"),
    apiSettingsBtn: document.getElementById("apiSettingsBtn"),
  };

  // ---------- Char count + example chips ----------
  el.description.addEventListener("input", () => {
    el.charCount.textContent = String(el.description.value.length);
  });

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      el.description.value = chip.dataset.example;
      el.charCount.textContent = String(el.description.value.length);
      el.description.focus();
    });
  });

  // ---------- API settings ----------
  el.apiSettingsBtn.addEventListener("click", () => {
    const current = getApiBaseUrl();
    const next = window.prompt(
      "Auto-Architect backend URL (the deployed 'api' service's public address):",
      current
    );
    if (next && next.trim()) setApiBaseUrl(next.trim().replace(/\/$/, ""));
  });
  refreshApiLabel();

  // ---------- Tabs ----------
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");

      const target = tab.dataset.tab;
      document.getElementById("blueprintView").hidden = target !== "blueprint";
      document.getElementById("zeropsView").hidden = target !== "zerops";
      document.getElementById("importView").hidden = target !== "import";
    });
  });

  // ---------- Copy buttons ----------
  document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const target = document.getElementById(btn.dataset.copyTarget);
      try {
        await navigator.clipboard.writeText(target.textContent);
        btn.textContent = "Copied";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("copied");
        }, 1400);
      } catch {
        btn.textContent = "Press Ctrl+C";
      }
    });
  });

  // ---------- States ----------
  function showState(name) {
    el.emptyState.hidden = name !== "empty";
    el.loadingState.hidden = name !== "loading";
    el.resultState.hidden = name !== "result";
  }

  function showError(message) {
    el.errorBox.textContent = message;
    el.errorBox.hidden = false;
  }
  function clearError() {
    el.errorBox.hidden = true;
    el.errorBox.textContent = "";
  }

  const LOADING_MESSAGES = [
    "Drafting the architecture…",
    "Picking real Zerops service types…",
    "Wiring up the private network…",
    "Writing zerops.yaml…",
  ];

  // ---------- Generate ----------
  let loadingInterval;

  el.generateBtn.addEventListener("click", generate);
  el.description.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
  });

  async function generate() {
    const description = el.description.value.trim();
    clearError();

    if (!description) {
      showError("Describe the app you want to build first.");
      return;
    }

    el.generateBtn.disabled = true;
    showState("loading");
    let msgIndex = 0;
    el.loadingText.textContent = LOADING_MESSAGES[0];
    loadingInterval = setInterval(() => {
      msgIndex = (msgIndex + 1) % LOADING_MESSAGES.length;
      el.loadingText.textContent = LOADING_MESSAGES[msgIndex];
    }, 1400);

    try {
      const res = await fetch(`${getApiBaseUrl()}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      renderResult(data);
      showState("result");
    } catch (err) {
      showState("empty");
      showError(
        err.message?.includes("fetch") || err.message?.includes("Failed to fetch")
          ? "Can't reach the backend. Check the API endpoint setting below."
          : err.message || "Something went wrong. Try again."
      );
    } finally {
      clearInterval(loadingInterval);
      el.generateBtn.disabled = false;
    }
  }

  function renderResult(data) {
    el.architectureSummary.textContent = data.architectureSummary || "";
    el.zeropsYamlCode.textContent = data.zeropsYaml || "";
    el.importYamlCode.textContent = data.projectImportYaml || "";
    el.diagramMount.innerHTML = buildDiagramSVG(data.services || []);
  }

  // ---------- Blueprint diagram renderer ----------
  const ROLE_COLOR = {
    frontend: "var(--cyan)",
    api: "var(--amber)",
    worker: "var(--amber)",
  };
  const DEFAULT_COLOR = "var(--mint)"; // database, cache, search, queue, vector-db, analytics-db

  function colorFor(service) {
    return ROLE_COLOR[service.role] || DEFAULT_COLOR;
  }

  function tierFor(service) {
    if (service.role === "frontend") return 0;
    if (service.role === "api" || service.role === "worker") return 1;
    return 2;
  }

  function escapeXml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
    }[c]));
  }

  function buildDiagramSVG(services) {
    if (!services.length) return "";

    const NODE_W = 176;
    const NODE_H = 70;
    const ROW_GAP = 28;
    const COL_GAP = 120;
    const PAD = 36;

    // group into tiers, keep only tiers that have services, preserve order
    const tierMap = new Map();
    services.forEach((s) => {
      const t = tierFor(s);
      if (!tierMap.has(t)) tierMap.set(t, []);
      tierMap.get(t).push(s);
    });
    const tiers = [...tierMap.keys()].sort((a, b) => a - b);
    const columns = tiers.map((t) => tierMap.get(t));

    const maxRows = Math.max(...columns.map((c) => c.length));
    const totalHeight = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP;
    const totalWidth = PAD * 2 + columns.length * NODE_W + (columns.length - 1) * COL_GAP;

    // compute positions
    const positions = new Map(); // hostname -> {x, y, w, h, color}
    columns.forEach((col, ci) => {
      const stackHeight = col.length * NODE_H + (col.length - 1) * ROW_GAP;
      const startY = PAD + (totalHeight - PAD * 2 - stackHeight) / 2;
      const x = PAD + ci * (NODE_W + COL_GAP);
      col.forEach((service, ri) => {
        const y = startY + ri * (NODE_H + ROW_GAP);
        positions.set(service.hostname, { x, y, w: NODE_W, h: NODE_H, color: colorFor(service), service });
      });
    });

    // edges
    const edgeSvgs = [];
    services.forEach((s) => {
      (s.connectsTo || []).forEach((targetHost) => {
        const from = positions.get(s.hostname);
        const to = positions.get(targetHost);
        if (!from || !to) return;

        const targetService = to.service;
        const isPrivate = targetService.kind === "managed";
        const x1 = from.x + from.w, y1 = from.y + from.h / 2;
        const x2 = to.x, y2 = to.y + to.h / 2;
        const midX = x1 + (x2 - x1) / 2;

        const path = `M ${x1} ${y1} H ${midX} V ${y2} H ${x2 - 8}`;
        edgeSvgs.push(`
          <path d="${path}" fill="none" stroke="${isPrivate ? "var(--mint)" : "var(--cyan)"}"
                stroke-width="1.4" stroke-dasharray="${isPrivate ? "4 4" : "none"}" opacity="0.75"
                marker-end="url(#arrow-${isPrivate ? "mint" : "cyan"})"/>
        `);
      });
    });

    // nodes
    const nodeSvgs = [];
    positions.forEach(({ x, y, w, h, color, service }) => {
      const label = escapeXml(service.hostname);
      const type = escapeXml(service.type);
      const role = escapeXml(service.role);
      const bracket = 10;

      nodeSvgs.push(`
        <g>
          <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"
                fill="var(--panel)" stroke="${color}" stroke-width="1.2" opacity="0.95"/>
          <!-- corner brackets -->
          <path d="M ${x} ${y + bracket} V ${y} H ${x + bracket}" fill="none" stroke="${color}" stroke-width="1.6"/>
          <path d="M ${x + w - bracket} ${y} H ${x + w} V ${y + bracket}" fill="none" stroke="${color}" stroke-width="1.6"/>
          <path d="M ${x + w} ${y + h - bracket} V ${y + h} H ${x + w - bracket}" fill="none" stroke="${color}" stroke-width="1.6"/>
          <path d="M ${x + bracket} ${y + h} H ${x} V ${y + h - bracket}" fill="none" stroke="${color}" stroke-width="1.6"/>

          <circle cx="${x + 16}" cy="${y + 20}" r="3.5" fill="${color}"/>
          <text x="${x + 28}" y="${y + 24}" font-family="IBM Plex Mono, monospace" font-size="13" font-weight="600" fill="var(--text)">${label}</text>
          <text x="${x + 16}" y="${y + 42}" font-family="IBM Plex Mono, monospace" font-size="10.5" fill="var(--text-muted)">${type}</text>
          <text x="${x + 16}" y="${y + 58}" font-family="Inter, sans-serif" font-size="9.5" letter-spacing="0.06em" fill="${color}">${role.toUpperCase()}</text>
        </g>
      `);
    });

    return `
      <svg viewBox="0 0 ${totalWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Architecture diagram">
        <defs>
          <marker id="arrow-cyan" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--cyan)"/>
          </marker>
          <marker id="arrow-mint" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--mint)"/>
          </marker>
        </defs>
        ${edgeSvgs.join("")}
        ${nodeSvgs.join("")}
      </svg>
    `;
  }
})();
