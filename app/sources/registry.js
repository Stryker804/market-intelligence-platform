"use strict";

/**
 * Source Registry — auto-discovery and generic collection.
 *
 * NEW sources are added by:
 *   1. Creating app/sources/<name>/adapter.js (or fetch.js + parser.js + normalizer.js)
 *   2. Adding a config block in config/default.js under sources.<name>
 *   3. That's it. No changes to core, pipeline, or API.
 *
 * Adapter contract (adapter.js must export):
 *   collect(config, fx, timestamp, opts) -> { ok, parsedCount, normalized, collectedAt, note }
 *
 * If adapter.js is absent, the registry falls back to the legacy pattern:
 *   fetch.js + parser.js + normalizer.js with a generic fixture fallback.
 *
 * Convention for fixture fallback:
 *   data/fixtures/<name>-latest.json
 */

const path = require("node:path");
const fs = require("node:fs");

const SOURCES_DIR = __dirname;

function discoverSourceNames() {
  const entries = fs.readdirSync(SOURCES_DIR, { withFileTypes: true });
  const skip = new Set(["registry.js", "index.js"]);
  return entries
    .filter((e) => e.isDirectory() && !skip.has(e.name))
    .map((e) => e.name)
    .sort();
}

function loadAdapter(sourceName) {
  const adapterPath = path.join(SOURCES_DIR, sourceName, "adapter.js");
  if (fs.existsSync(adapterPath)) {
    return require(adapterPath);
  }
  return null;
}

function fixturePath(sourceName) {
  return path.join(SOURCES_DIR, "..", "data", "fixtures", `${sourceName}-latest.json`);
}

function loadFixture(sourceName) {
  const fp = fixturePath(sourceName);
  return JSON.parse(fs.readFileSync(fp, "utf8"));
}

/**
 * Generic collect: handles the common fetch→fallback→normalize pattern.
 * Used when an adapter does not export its own collect().
 */
async function genericCollect(sourceName, modules, config, fx, timestamp, { forceFixture = false } = {}) {
  const c = config.sources[sourceName];
  if (!c) return { ok: false, reason: "NOT_CONFIGURED", normalized: [] };

  const note = {};
  let raw;

  try {
    if (forceFixture) throw new Error("offline mode: fixture");
    if (typeof modules.fetch === "function") {
      raw = await modules.fetch(c);
    } else if (typeof modules.fetchRaw === "function") {
      raw = await modules.fetchRaw(c);
    } else {
      throw new Error("no fetch function");
    }
    note.source = "live";
  } catch (error) {
    note.error = error.message;
    if (c.preferFixtureIfUnavailable) {
      try {
        raw = loadFixture(sourceName);
        note.source = "fixture";
        note.fixture = true;
      } catch {
        return { ok: false, reason: note.error, normalized: [] };
      }
    } else {
      return { ok: false, reason: note.error, normalized: [] };
    }
  }

  const parsed = typeof modules.parse === "function" ? modules.parse(raw) : raw;
  const normalized = typeof modules.normalize === "function"
    ? modules.normalize(parsed, { fxRate: fx.rate, baseCurrency: config.currency.base, timestamp })
    : [];

  return { ok: true, parsedCount: Array.isArray(parsed) ? parsed.length : 0, normalized, collectedAt: timestamp, note };
}

/**
 * Collect from a single source by name.
 * Tries adapter.collect() first, then falls back to genericCollect.
 */
async function collectSource(sourceName, config, fx, timestamp, opts = {}) {
  const adapter = loadAdapter(sourceName);
  if (adapter && typeof adapter.collect === "function") {
    return adapter.collect(config, fx, timestamp, opts);
  }

  const modules = {};
  try { modules.fetch = require(path.join(SOURCES_DIR, sourceName, "fetch")); } catch { /* ok */ }
  try { modules.parse = require(path.join(SOURCES_DIR, sourceName, "parser")); } catch { /* ok */ }
  try { modules.normalize = require(path.join(SOURCES_DIR, sourceName, "normalizer")); } catch { /* ok */ }

  const fnName = `normalize${sourceName.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("")}`;
  if (modules.normalize && typeof modules.normalize[fnName] === "function") {
    const orig = modules.normalize;
    modules.normalize = (parsed, ctx) => orig[fnName](parsed, ctx);
  }

  const fetchMod = modules.fetch;
  if (fetchMod) {
    const fetchFnName = Object.keys(fetchMod).find((k) => k.startsWith("fetch"));
    if (fetchFnName) {
      const origFetch = fetchMod;
      modules.fetch = (c) => origFetch[fetchFnName](c);
    }
  }

  return genericCollect(sourceName, modules, config, fx, timestamp, opts);
}

/**
 * Collect from all enabled sources.
 * Returns { results: { [sourceName]: result }, state }.
 */
async function collectAll(config, fx, timestamp, opts = {}) {
  const names = discoverSourceNames();
  const results = {};
  const allSnapshots = [];

  for (const name of names) {
    const src = config.sources && config.sources[name];
    if (!src || src.enabled === false) {
      results[name] = { ok: false, reason: "DISABLED", normalized: [] };
      continue;
    }
    try {
      const result = await collectSource(name, config, fx, timestamp, opts);
      results[name] = result;
      if (result.ok && Array.isArray(result.normalized)) {
        allSnapshots.push(...result.normalized);
      }
    } catch (error) {
      results[name] = { ok: false, reason: error.message, normalized: [] };
    }
  }

  return { results, allSnapshots };
}

module.exports = {
  discoverSourceNames,
  loadAdapter,
  collectSource,
  collectAll,
  genericCollect,
  fixturePath,
  loadFixture,
};
