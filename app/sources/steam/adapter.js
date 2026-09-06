"use strict";

/**
 * Steam adapter entry point (standard adapter contract).
 *
 *   collect(config, fx, timestamp, opts) -> { ok, parsedCount, normalized, collectedAt, note }
 *
 * Steam is a per-item orderbook source: it requires `opts.candidates` —
 * the list of item names to query (usually derived from a catalog source).
 *
 * opts:
 *   - forceFixture (bool): offline mode.
 *   - candidates (array<string>): market hash names to query.
 */

const { parseSteamOrderbook, parseResearchRecord } = require("./parser");
const { normalizeSteam } = require("./normalizer");
const steamFetch = require("./fetch");
const path = require("node:path");
const fs = require("node:fs");

const FIXTURE = path.join(__dirname, "..", "..", "data", "fixtures", "steam-orders.json");

function loadSteamFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
}

async function collect(config, fx, timestamp, { forceFixture = false, candidates = [] } = {}) {
  const c = config.sources.steam;
  const note = { source: "live", fetched: 0, failed: 0 };
  const results = [];
  let usedFixture = false;

  try {
    if (forceFixture) throw new Error("offline mode: fixture");
    let idx = 0;
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

    while (idx < candidates.length && results.length < (c.maxItemsPerRun || 200)) {
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
      return { ok: false, reason: note.error || "no steam data", parsed: [], normalized: [] };
    }
  }

  if (parsed.length === 0) {
    return { ok: false, reason: note.error || "no steam data", parsed: [], normalized: [] };
  }

  const normalized = [];
  for (const p of parsed) {
    for (const snap of normalizeSteam(p, { baseCurrency: config.currency.base, fx, timestamp })) {
      normalized.push(snap);
    }
  }
  return { ok: true, usedFixture, parsedCount: parsed.length, normalized, collectedAt: timestamp, note };
}

module.exports = { collect };
