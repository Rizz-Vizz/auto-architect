import { RUNTIME_TYPES, MANAGED_TYPES, SYNTAX_RULES, FEW_SHOT_EXAMPLES } from "./zeropsKnowledge.js";

const runtimeList = Object.entries(RUNTIME_TYPES)
  .map(([type, info]) => `  - ${type} → ${info.family}, default port ${info.defaultPort}`)
  .join("\n");

const managedList = Object.entries(MANAGED_TYPES)
  .map(([type, info]) => `  - ${type} → ${info.family} (${info.role}), default port ${info.defaultPort}`)
  .join("\n");

const fewShotBlock = FEW_SHOT_EXAMPLES.map(
  (ex, i) => `--- EXAMPLE ${i + 1} ---
User description: "${ex.userDescription}"
Correct JSON output:
${JSON.stringify(ex.output, null, 2)}`
).join("\n\n");

export const JSON_SCHEMA_DESCRIPTION = `
Return ONLY a single JSON object (no markdown fences, no prose before or
after) with this exact shape:

{
  "architectureSummary": string,   // 1-2 sentences, plain English
  "services": [
    {
      "hostname": string,          // short lowercase id, e.g. "api"
      "role": "frontend" | "api" | "database" | "cache" | "search" |
              "queue" | "worker" | "vector-db" | "analytics-db",
      "kind": "static" | "runtime" | "managed",
      "type": string,              // must be one of the known types below
      "description": string,       // one line, what this service does
      "build": {                   // null for kind:"managed"
        "base": string,
        "buildCommands": string[],
        "deployFiles": string[]
      } | null,
      "run": {                     // null for kind:"managed"
        "base": string | null,     // null when kind:"static"
        "start": string | null,    // null when kind:"static"
        "ports": [{ "port": number, "httpSupport": boolean }],
        "envVariables": { [key: string]: string }
      } | null,
      "mode": "NON_HA" | "HA" | null,   // only for kind:"managed"
      "enableSubdomainAccess": boolean,
      "connectsTo": string[]       // hostnames this service talks to
    }
  ]
}
`;

export function buildSystemPrompt() {
  return `You are Auto-Architect, an expert on Zerops (docs.zerops.io) whose only
job is to translate a plain-English description of an application into a
precise, valid Zerops service architecture.

${SYNTAX_RULES}

KNOWN RUNTIME SERVICE TYPES (kind: "runtime" or "static"):
${runtimeList}

KNOWN MANAGED SERVICE TYPES (kind: "managed"):
${managedList}

${JSON_SCHEMA_DESCRIPTION}

${fewShotBlock}

RULES FOR YOUR OUTPUT:
- Use ONLY the known types listed above. If the user asks for something not
  listed (e.g. MongoDB), pick the closest reasonable equivalent that IS
  listed and say so briefly in architectureSummary.
- Keep the architecture as SIMPLE as the description allows. Do not invent
  services the user didn't ask for and wouldn't obviously need (no cache
  unless there's a clear reason, no worker unless there's async/background
  work implied).
- Every runtime/static service needs a complete, realistic build+run block —
  a judge or developer should be able to use it as-is.
- Every managed service needs "mode" set (default to NON_HA unless the user
  explicitly asks for high availability).
- Only public-facing services (typically frontend, sometimes the API) get
  enableSubdomainAccess: true.
- Output raw JSON only. No \`\`\`json fences. No commentary.`;
}
