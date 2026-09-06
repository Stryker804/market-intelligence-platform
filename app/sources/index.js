"use strict";

/**
 * Source registry (public facade).
 *
 * NEW sources are added by:
 *   1. Creating app/sources/<name>/adapter.js (or fetch.js + parser.js + normalizer.js)
 *   2. Adding a config block in config/default.js under sources.<name>
 *   3. That's it. No changes to core, pipeline, or API.
 *
 * See ADDING_NEW_SOURCE.md for the full workflow.
 */

const registry = require("./registry");
const { parseLootFarm } = require("./lootfarm/parser");
const { normalizeLootFarm } = require("./lootfarm/normalizer");
const lootfarmFetch = require("./lootfarm/fetch");
const path = require("node:path");
const fs = require("node:fs");
const fsLootFarmFixture = path.join(__dirname, "..", "data", "fixtures", "lootfarm-latest.json");

const { parseSteamOrderbook, parseResearchRecord } = require("./steam/parser");
const { normalizeSteam } = require("./steam/normalizer");
const steamFetch = require("./steam/fetch");
const steamFixtureFile = path.join(__dirname, "..", "data", "fixtures", "steam-orders.json");

// ---- Legacy, backward-compatible entry points (kept for existing callers) ----

async function collectLootFarm(config, fx, timestamp, { forceFixture = false } = {}) {
  const c = config.sources.lootfarm;
  const note = {};
  let raw;
  try {
    if (forceFixture) throw new Error("offline mode: fixture");
    raw = await lootfarmFetch.fetchRawCatalog({ url: c.url, timeoutMs: c.timeoutMs, retries: c.retries });
    note.source = "live";
  } catch (error) {
    note.error = error.message;
    if (c.preferFixtureIfUnavailable) {
      try {
        raw = JSON.parse(fs.readFileSync(fsLootFarmFixture, "utf8"));
        note.source = "fixture";
        note.fixture = true;
      } catch (e2) {
        return { ok: false, reason: note.error, parsed: [] };
      }
    } else {
      return { ok: false, reason: note.error, parsed: [] };
    }
  }
  const parsed = parseLootFarm(raw);
  const normalized = normalizeLootFarm(parsed, {
    fxRate: fx.rate,
    baseCurrency: config.currency.base,
    timestamp,
  });
  return {
    ok: true,
    parsedCount: parsed.length,
    normalized,
    collectedAt: timestamp,
    note,
  };
}

function loadSteamFixture() {
  return JSON.parse(fs.readFileSync(steamFixtureFile, "utf8"));
}

async function collectSteam(config, candidates, fx, timestamp, { forceFixture = false } = {}) {
  const c = config.sources.steam;
  const note = { source: "live", fetched: 0, failed: 0 };
  const results = [];
  let usedFixture = false;

  try {
    if (forceFixture) throw new Error("offline mode: fixture");
    let i = 0;
    const task = async (name) => {
      const delayMs = c.requestDelayMs || 350;
      await new Promise((r) => setTimeout(r, delayMs + Math.floor(Math.random() * 80)));
      try {
        const raw = await steamFetch.fetchSteamOrderbook(name, {
          url: c.orderbookUrl,
          timeoutMs: c.timeoutMs,
        });
        const parsed = parseSteamOrderbook(raw, name);
        if (parsed.ok) {
          note.fetched += 1;
          return parsed;
        }
        note.failed += 1;
        return null;
      } catch (error) {
        note.failed += 1;
        return null;
      }
    };

    let idx = 0;
    while (idx < candidates.length && results.length < c.maxItemsPerRun) {
      const batch = [];
      for (let b = 0; b < (c.concurrency || 8) && idx < candidates.length; b += 1, idx += 1) {
        batch.push(task(candidates[idx]));
      }
      const done = await Promise.all(batch);
      results.push(...done.filter(Boolean));
    }
  } catch (error) {
    note.error = error.message;
  }

  let parsed = results;
  if (parsed.length === 0 && c.preferFixtureIfUnavailable) {
    try {
      const fixture = loadSteamFixture();
      parsed = fixture.map(parseResearchRecord);
      note.source = "fixture";
      note.fixture = true;
      note.fallbackFrom = note.error || "no live data";
      usedFixture = true;
    } catch (e2) {
      return { ok: false, reason: note.error || "no steam data", parsed: [] };
    }
  }

  if (parsed.length === 0) {
    return { ok: false, reason: note.error || "no steam data", parsed: [] };
  }

  const normalized = [];
  for (const p of parsed) {
    for (const snap of normalizeSteam(p, { baseCurrency: config.currency.base, fx, timestamp })) {
      normalized.push(snap);
    }
  }
  return { ok: true, usedFixture, parsedCount: parsed.length, normalized, collectedAt: timestamp, note };
}

function normalizeValueForState(snap) {
  return {
    priceRub: snap.price,
    priceType: snap.priceType,
    quantity: snap.quantity,
    orderCount: snap.orderCount,
    levels: snap.levels,
    timestamp: snap.timestamp,
  };
}

module.exports = {
  collectLootFarm,
  collectSteam,
  loadSteamFixture,
  normalizeValueForState,
  collectSource: registry.collectSource,
  collectAll: registry.collectAll,
  discoverSourceNames: registry.discoverSourceNames,
};
