"use strict";

const { PAGES } = require("../config/pages");

/**
 * REST API. All responses are JSON. Errors are reported explicitly as
 * 200 with { error: {...} } or proper HTTP codes — no silent mocks.
 */

function json(res, value, code = 200, extra = {}) {
  const body = JSON.stringify(value);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...extra,
  });
  res.end(body);
}

function jsonError(res, message, code = 500, extra = {}) {
  return json(res, { error: message }, code, extra);
}

/**
 * Minimal cross-origin protection for state-changing endpoints.
 *
 * Browsers always attach an Origin header to cross-origin POSTs; a page on an
 * attacker's site therefore carries a foreign Origin. We accept only:
 *   1. requests without an Origin header (non-browser clients — curl, CLI,
 *      tests, same-machine automation), and
 *   2. requests whose Origin matches the request Host (i.e. a real
 *      same-origin page on the currently served site/proxy), or one of the
 *      explicitly configured ALLOWED_ORIGINS.
 * This is not an authentication system — it only prevents cross-site
 * state-changing calls, which are the audit's blocker. The "null" origin
 * (sandboxed iframe / file: page) is rejected.
 */
function isAllowedOrigin(req, config) {
  const origin = req.headers.origin;
  // No Origin header = non-browser client (curl, CLI, tests, node fetch).
  // Browsers always attach Origin to cross-origin POSTs, so this is not a
  // bypass for a browser-mounted attack.
  if (!origin) return true;
  // The "null" origin (sandboxed iframe, file:// page) is rejected.
  if (origin === "null" || origin === "undefined") return false;
  const allowed = config.server.allowedOrigins || [];
  if (allowed.some((a) => a === origin)) return true;
  const h = req.headers.host;
  if (h && (origin === `http://${h}` || origin === `https://${h}`)) return true;
  return false;
}

function paramList(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function decodePart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function bodyLimitError() {
  const e = new Error("payload too large");
  e.code = "PAYLOAD_TOO_LARGE";
  return e;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    let overflow = false;
    const LIMIT = 20 * 1024 * 1024; // 20 MB safety cap for JSON payloads
    req.on("data", (chunk) => {
      if (overflow) return; // drain and discard, keep the connection consistent
      size += chunk.length;
      if (size > LIMIT) {
        overflow = true;
        chunks = [];
        reject(bodyLimitError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (overflow) return;
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function readTextBody(req, limit = 100 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    let overflow = false;
    req.on("data", (chunk) => {
      if (overflow) return; // drain and discard, keep the connection consistent
      size += chunk.length;
      if (size > limit) {
        overflow = true;
        chunks = [];
        reject(bodyLimitError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (overflow) return;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function exportCsv(res, { csv, filename }) {
  const body = Buffer.from(csv, "utf8");
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Length": body.length,
    "Content-Disposition": `attachment; filename="${filename || "analysis-result.csv"}"`,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function handleImport(req, res, url, udata, udataApi) {
  // Accept CSV as the raw request body (the frontend uploads the file
  // bytes directly). Original user files are never modified — the bytes
  // are parsed into an in-memory working copy only.
  const text = await readTextBody(req);
  const name = decodePart(url.searchParams.get("name") || "upload.csv");

  const importResult = udata.upload({ text, name });
  return json(res, {
    ok: true,
    name,
    summary: udata.dataset.summary(),
    message: `Загружено: ${udata.dataset.summary().rows} строк, ${udata.dataset.summary().columns} колонок`,
  });
}

function createApi({ config, store, udata }) {
  const api = require("./handlers")({ config, store });
  const udataApi = udata ? require("./udata-handler").createUdataHandler(udata) : null;

  return async function handleApi(req, res, url, { runCollection }) {
    const method = req.method || "GET";
    const parts = url.pathname.split("/").filter(Boolean); // ['api', ...]

    if (parts[0] !== "api") return false;

    try {
      if (method === "GET" && parts.length === 2 && parts[1] === "health") {
        return json(res, { ok: true, uptime: process.uptime(), time: new Date().toISOString() });
      }

      if (method === "GET" && parts.length === 2 && parts[1] === "pages") {
        return json(res, { pages: Object.keys(PAGES), definitions: PAGES });
      }

      if (method === "GET" && parts.length === 3 && parts[1] === "pages") {
        const name = parts[2];
        if (!PAGES[name]) return jsonError(res, `page not found: ${name}`, 404);
        return json(res, PAGES[name]);
      }

      if (method === "GET" && parts.length === 2 && parts[1] === "config") {
        return json(res, api.config());
      }

      if (method === "GET" && parts.length === 2 && parts[1] === "sources") {
        return json(res, api.sources());
      }

      if (method === "GET" && parts.length === 2 && parts[1] === "stats") {
        return json(res, api.stats());
      }

      if (method === "GET" && parts.length === 2 && parts[1] === "markets") {
        return json(res, api.markets(url.searchParams));
      }

      if (method === "GET" && parts.length === 3 && parts[1] === "items") {
        return json(res, api.item(decodePart(parts[2])));
      }

      if (method === "GET" && parts.length === 3 && parts[1] === "history") {
        return json(res, api.history(decodePart(parts[2])));
      }

      if (method === "GET" && parts.length === 2 && parts[1] === "arbitrage") {
        return json(res, api.arbitrage(url.searchParams));
      }

      if (method === "GET" && parts.length === 2 && parts[1] === "fx") {
        return json(res, api.fx());
      }

      // POST /api/refresh (manual pipeline trigger) is intentionally NOT a
      // public route. Collection is run by the server-side scheduler (
      // server.js periodic collection) or by the CLI (app/scripts/collect.js).
      // A public state-changing endpoint must not exist on an open deploy.

      // ---- Universal Data (isolated consumer-facing module) ----
      if (udataApi) {
        if (method === "GET" && parts.length === 2 && parts[1] === "udata") {
          return json(res, udataApi.status());
        }

        if (method === "GET" && parts.length === 3 && parts[1] === "udata" && parts[2] === "inspect") {
          const preview = parseInt(url.searchParams.get("preview") || "8", 10) || 8;
          return json(res, udataApi.inspect({ preview }));
        }

        if (method === "GET" && parts.length === 3 && parts[1] === "udata" && parts[2] === "analysis") {
          return json(res, udataApi.analyze());
        }

        if (method === "GET" && parts.length === 3 && parts[1] === "udata" && parts[2] === "export") {
          return udataApi.exportCsv ? udataApi.exportCsv(res) : exportCsv(res, udataApi.export());
        }

        // State-changing POST endpoints: rejected when the Origin header is
        // present but does not match the same origin (or ALLOWED_ORIGINS).
        if (method === "POST" && parts.length === 3 && parts[1] === "udata" && parts[2] === "import") {
          if (!isAllowedOrigin(req, config)) return jsonError(res, "cross-origin request rejected", 403);
          return await handleImport(req, res, url, udata, udataApi);
        }

        if (method === "POST" && parts.length === 3 && parts[1] === "udata" && parts[2] === "transform") {
          if (!isAllowedOrigin(req, config)) return jsonError(res, "cross-origin request rejected", 403);
          const body = await readJsonBody(req);
          return json(res, udataApi.transform(body));
        }

        if (method === "POST" && parts.length === 3 && parts[1] === "udata" && parts[2] === "reset") {
          if (!isAllowedOrigin(req, config)) return jsonError(res, "cross-origin request rejected", 403);
          return json(res, udataApi.reset());
        }
      }

      return jsonError(res, `unknown api route: /${parts.join("/")}`, 404);
    } catch (error) {
      if (error && error.code === "PAYLOAD_TOO_LARGE") {
        // Oversized body: reply 413 and close the connection instead of
        // destroying the socket (a destroyed socket can drop the response and
        // risk an unhandled res 'error' event).
        return jsonError(res, error.message || "payload too large", 413, { Connection: "close" });
      }
      return jsonError(res, error.message || "internal error");
    }
  };
}

module.exports = { createApi };