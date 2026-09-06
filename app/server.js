"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const { config } = require("./config/default");
const { Store } = require("./core/storage");
const { runCollection } = require("./pipeline");
const { createApi } = require("./api/routes");
const { createUdataController } = require("./universal-data/server");

const FRONTEND_DIR = path.join(__dirname, "frontend");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function safePath(rel) {
  const target = path.normalize(path.join(FRONTEND_DIR, rel));
  if (!target.startsWith(FRONTEND_DIR)) return null;
  return target;
}

function sendFile(res, filePath) {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": data.length,
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function parseArgs(argv) {
  const out = { port: null, offline: false, collectOnce: false, noCollect: false, host: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--offline") out.offline = true;
    if (a === "--collect-once" || a === "--collect") out.collectOnce = true;
    if (a === "--no-collect") out.noCollect = true;
    if (a === "--port") out.port = parseInt(argv[i + 1], 10);
    if (a === "--host") out.host = argv[i + 1];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = args.port || config.server.port;
  const host = args.host || config.server.host;
  const offline = args.offline;

  const store = new Store(config.dataDir);
  const udata = createUdataController();
  const api = createApi({ config, store, udata });

  let collecting = false;
  async function collect({ live }) {
    if (collecting) return { ok: false, error: "collection already in progress" };
    collecting = true;
    try {
      const result = await runCollection({ config, store, live });
      logCollection(result);
      return result;
    } finally {
      collecting = false;
    }
  }

  function logCollection(result) {
    const r = result.results || {};
    const s = r.sources || {};
    const stamp = r.timestamp || "";
    console.log(
      `[collect ${stamp}] ok=${result.ok} ` +
        `lootfarm=${s.lootfarm ? s.lootfarm.items + " items" : "fail"} ` +
        `steam=${s.steam ? s.steam.items + " items" : "fail"} ` +
        `opp=${r.opportunities ? r.opportunities.opportunitiesDetected : "-"}`,
    );
  }

  const server = http.createServer(async (req, res) => {
    // Minimal security headers on every response. Full CSP is intentionally
    // not applied yet — the frontend uses inline handlers/innerHTML.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await api(req, res, url, { runCollection: collect });
      return;
    }

    const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const filePath = safePath(rel);
    if (filePath) {
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) return sendFile(res, filePath);
      } catch {
        /* fall through */
      }
    }
    // SPA fallback to index
    sendFile(res, path.join(FRONTEND_DIR, "index.html"));
  });

  const hasData = fs.existsSync(path.join(config.dataDir, "state", "items.json"));

  if (!args.noCollect && (args.collectOnce || (!hasData && config.collection.runOnStart))) {
    console.log(`[startup] collecting data (live=${!offline})...`);
    await collect({ live: !offline });
  } else if (args.noCollect) {
    console.log("[startup] collection skipped (--no-collect)");
  } else {
    console.log("[startup] using existing stored data");
  }

  server.listen(port, host, () => {
    console.log(`===============================================`);
    console.log(`  Market Intelligence Platform`);
    console.log(`  http://${host}:${port}`);
    console.log(`  data dir: ${config.dataDir}`);
    console.log(`  mode: ${offline ? "offline (fixtures)" : "live"}`);
    console.log(`===============================================`);
  });

  if (!args.noCollect && !args.collectOnce && config.collection.intervalMinutes > 0) {
    const intervalMs = config.collection.intervalMinutes * 60 * 1000;
    setInterval(() => {
      console.log("[scheduler] periodic collection...");
      collect({ live: !offline }).catch((e) => console.error("[scheduler] error", e.message));
    }, intervalMs);
  }
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});