// zeropsKnowledge.js
//
// Grounding data for the LLM prompt. Everything in here is taken directly
// from docs.zerops.io (runtime pages, zerops.yaml specification, import
// reference, and the per-runtime "env variables" pages) so the model isn't
// guessing at syntax it half-remembers. Keeping this in one file also means
// if Zerops changes a convention, there's exactly one place to update it.

// Runtime services: built from source, need a `build` + `run` section in
// zerops.yaml. `defaultPort` is just a sane default the model can override.
export const RUNTIME_TYPES = {
  "nodejs@22": { family: "Node.js", defaultPort: 3000, startHint: "npm start / node server.js" },
  "nodejs@20": { family: "Node.js", defaultPort: 3000, startHint: "npm start / node server.js" },
  "python@3.12": { family: "Python", defaultPort: 8000, startHint: "uvicorn main:app --host 0.0.0.0 --port 8000" },
  "python@3.11": { family: "Python", defaultPort: 8000, startHint: "gunicorn app:app -b 0.0.0.0:8000" },
  "go@1.22": { family: "Go", defaultPort: 8080, startHint: "./app" },
  "rust@1": { family: "Rust", defaultPort: 8080, startHint: "./target/release/app" },
  "dotnet@8": { family: ".NET", defaultPort: 8080, startHint: "dotnet app.dll" },
  "java@21": { family: "Java", defaultPort: 8080, startHint: "java -jar app.jar" },
  "php-apache@8.3": { family: "PHP", defaultPort: 80, startHint: "(served by Apache automatically)" },
  "bun@1.1": { family: "Bun", defaultPort: 3000, startHint: "bun run start" },
  "deno@1": { family: "Deno", defaultPort: 8000, startHint: "deno run --allow-net main.ts" },
  "static": { family: "Static / Nginx", defaultPort: 80, startHint: "(no start command — Nginx serves deployFiles)" },
};

// Managed services: fully hosted by Zerops. They only ever need an entry in
// the *project import* file (hostname/type/mode) — never a zerops.yaml
// build/run block, because there's no app code to build.
export const MANAGED_TYPES = {
  "postgresql@16": { family: "PostgreSQL", role: "database", defaultPort: 5432 },
  "mariadb@10.6": { family: "MariaDB", role: "database", defaultPort: 3306 },
  "valkey@7.2": { family: "Valkey (Redis-compatible)", role: "cache", defaultPort: 6379 },
  "keydb@6.3.4": { family: "KeyDB (Redis-compatible)", role: "cache", defaultPort: 6379 },
  "elasticsearch@8": { family: "Elasticsearch", role: "search", defaultPort: 9200 },
  "typesense@0.25.1": { family: "Typesense", role: "search", defaultPort: 8108 },
  "meilisearch@1.6": { family: "Meilisearch", role: "search", defaultPort: 7700 },
  "qdrant@1.9.2": { family: "Qdrant", role: "vector-db", defaultPort: 6333 },
  "nats@2.10": { family: "NATS", role: "queue", defaultPort: 4222 },
  "kafka@3.6": { family: "Kafka", role: "queue", defaultPort: 9092 },
  "clickhouse@24.3": { family: "ClickHouse", role: "analytics-db", defaultPort: 9000 },
};

// The exact prose rules the model needs to not screw up syntax.
export const SYNTAX_RULES = `
ZEROPS SYNTAX RULES (do not deviate from these):

1. Two DIFFERENT yaml files exist and serve different purposes:
   a. "zerops.yaml" — build & run pipeline config. ONLY for runtime/static
      services (things built from source). Lives in the repo root (or each
      service's subfolder). Top-level key is "zerops:", an array, one entry
      per runtime service:
        zerops:
          - setup: <hostname>
            build:
              base: <runtime@version>
              buildCommands: [ ... ]
              deployFiles: [ ... ]        # or a single path like ./dist
              cache: node_modules          # optional
            run:
              base: <runtime@version>      # omit for "static"
              ports:
                - port: <number>
                  httpSupport: true
              start: <command>             # omit for "static"
              envVariables:                # optional
                KEY: value

   b. "zerops-project-import.yaml" — infrastructure description used once,
      at project-creation time, to spin up ALL services (runtime AND
      managed). Top-level keys are "project" and "services":
        project:
          name: <project-name>
        services:
          - hostname: <hostname>
            type: <runtime@version | managed@version | static>
            enableSubdomainAccess: true      # only meaningful for
                                              # public-facing services
          - hostname: db
            type: postgresql@16
            mode: NON_HA                     # managed DBs only: NON_HA or HA
            priority: 1                      # start managed services first

2. Managed services (databases, caches, search, queues) NEVER get a
   zerops.yaml build/run block — they're pre-built. They only appear in
   zerops-project-import.yaml.

3. Cross-service references: any service can read another service's
   variables with \${hostname_key} syntax, e.g. \${db_connectionString},
   \${db_hostname}, \${db_user}, \${db_password}, \${db_dbName},
   \${cache_connectionString}. Zerops auto-generates these for managed
   services — never invent a plaintext password, always reference the
   generated variable.

4. hostname values: lowercase, short, no spaces (e.g. "api", "web", "db",
   "cache", "worker"). Never reuse a hostname across services.

5. Only give a service "enableSubdomainAccess: true" if it needs to be
   reachable from the public internet (typically the frontend and/or the
   API if the frontend calls it directly). Databases and caches never get
   public access.
`;

// Two full, correct worked examples in the exact JSON shape we want back.
// These are what actually anchor the model's output — the prose rules above
// are backup context, this is the pattern it will copy.
export const FEW_SHOT_EXAMPLES = [
  {
    userDescription: "A React frontend, a Node API, and a Postgres database",
    output: {
      architectureSummary:
        "A static React frontend calls a Node.js API over the public internet; the API talks to a private PostgreSQL database over Zerops' internal network.",
      services: [
        {
          hostname: "web",
          role: "frontend",
          kind: "static",
          type: "static",
          description: "React app, built to static files and served by Nginx.",
          build: {
            base: "nodejs@22",
            buildCommands: ["npm install", "npm run build"],
            deployFiles: ["dist/~"],
          },
          run: { base: "static", start: null, ports: [{ port: 80, httpSupport: true }], envVariables: {} },
          mode: null,
          enableSubdomainAccess: true,
          connectsTo: ["api"],
        },
        {
          hostname: "api",
          role: "api",
          kind: "runtime",
          type: "nodejs@22",
          description: "Node.js/Express API handling business logic and DB access.",
          build: {
            base: "nodejs@22",
            buildCommands: ["npm install", "npm run build"],
            deployFiles: ["dist", "package.json", "node_modules"],
          },
          run: {
            base: "nodejs@22",
            start: "npm start",
            ports: [{ port: 3000, httpSupport: true }],
            envVariables: {
              DATABASE_URL: "${db_connectionString}",
            },
          },
          mode: null,
          enableSubdomainAccess: true,
          connectsTo: ["db"],
        },
        {
          hostname: "db",
          role: "database",
          kind: "managed",
          type: "postgresql@16",
          description: "Managed PostgreSQL database, single-container mode.",
          build: null,
          run: null,
          mode: "NON_HA",
          enableSubdomainAccess: false,
          connectsTo: [],
        },
      ],
    },
  },
  {
    userDescription: "A Python API with a Postgres database and a Redis-style cache for sessions",
    output: {
      architectureSummary:
        "A Python API is the only public-facing service. It persists data in PostgreSQL and stores session data in a Valkey (Redis-compatible) cache, both reached over the private network.",
      services: [
        {
          hostname: "api",
          role: "api",
          kind: "runtime",
          type: "python@3.12",
          description: "Python API (e.g. FastAPI) serving all application logic.",
          build: {
            base: "python@3.12",
            buildCommands: ["pip install -r requirements.txt"],
            deployFiles: ["./"],
          },
          run: {
            base: "python@3.12",
            start: "uvicorn main:app --host 0.0.0.0 --port 8000",
            ports: [{ port: 8000, httpSupport: true }],
            envVariables: {
              DATABASE_URL: "${db_connectionString}",
              REDIS_URL: "${cache_connectionString}",
            },
          },
          mode: null,
          enableSubdomainAccess: true,
          connectsTo: ["db", "cache"],
        },
        {
          hostname: "db",
          role: "database",
          kind: "managed",
          type: "postgresql@16",
          description: "Managed PostgreSQL database.",
          build: null,
          run: null,
          mode: "NON_HA",
          enableSubdomainAccess: false,
          connectsTo: [],
        },
        {
          hostname: "cache",
          role: "cache",
          kind: "managed",
          type: "valkey@7.2",
          description: "Managed Valkey cache for sessions and hot data.",
          build: null,
          run: null,
          mode: "NON_HA",
          enableSubdomainAccess: false,
          connectsTo: [],
        },
      ],
    },
  },
];
