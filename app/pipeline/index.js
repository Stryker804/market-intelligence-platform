"use strict";

const sources = require("../sources");
const { runOpportunityEngine } = require("../core/opportunity");
const { fetchFxRate } = require("../core/fx");
const { identityWithSafeName } = require("../core/canonical");

/**
 * Pipeline orchestrator:
 *   collect -> parse -> normalize -> store -> history -> analyze -> detect -> report
 *
 * The pipeline is source-agnostic: it iterates every enabled source registered
 * in config.sources and discovered by sources/registry.js. New sources require
 * NO changes here — only an adapter directory + a config block.
 *
 * Source roles:
 *   - "catalog"  : returns a full item universe (e.g. lootfarm). Collected first.
 *   - "per-item" : queries individual items (e.g. steam). Fed `opts.candidates`
 *                  derived from the reference universe (config.priceFilterSource).
 */

function buildStateFromSnapshots(snapshots, existingState) {
  const state = existingState || {};
  for (const snap of snapshots) {
    const key = snap.identityKey;
    let item = state[key];
    if (!item) {
      item = {
        identityKey: key,
        marketHashName: snap.marketHashName,
        itemName: snap.itemName,
        game: snap.game,
        category: snap.category,
        exterior: snap.exterior,
        stattrak: snap.stattrak,
        souvenir: snap.souvenir,
        phase: snap.phase,
        sources: {},
      };
      state[key] = item;
    } else {
      item.marketHashName = item.marketHashName || snap.marketHashName;
    }

    const tgt = item.sources[snap.source] || (item.sources[snap.source] = {});
    if (snap.priceType === "SELL") {
      tgt.sellRub = snap.price;
      tgt.sellQuantity = snap.quantity;
      tgt.sellOrderCount = snap.orderCount;
      tgt.sellLevels = snap.levels;
      tgt.timestamp = snap.timestamp;
      tgt.currency = snap.currency;
    } else if (snap.priceType === "BID") {
      tgt.buyRub = snap.price;
      tgt.buyQuantity = snap.quantity;
      tgt.buyOrderCount = snap.orderCount;
      tgt.buyLevels = snap.levels;
      tgt.timestamp = snap.timestamp;
      tgt.currency = snap.currency;
    } else {
      tgt.priceRub = snap.price;
      tgt.priceType = snap.priceType;
      tgt.quantity = snap.quantity;
      tgt.levels = snap.levels;
      tgt.timestamp = snap.timestamp;
      tgt.currency = snap.currency;
    }
  }
  return state;
}

/**
 * Derive the reference candidate list (for per-item sources) from the
 * catalog snapshots of `sourceName`.
 */
function selectCandidates(catalogSnapshots, config, sourceName) {
  const src = config.sources[sourceName];
  const type = (src && src.priceFilterType) || "BUY";
  const min = config.filters.minPriceRub;
  const max = config.filters.maxPriceRub;
  const limit = (src && src.maxItemsPerRun) || 200;

  return catalogSnapshots
    .filter(
      (snap) =>
        snap.priceType === type &&
        (snap.quantity || 0) > 0 &&
        snap.price >= min &&
        snap.price <= max,
    )
    .sort((a, b) => b.price * (b.quantity || 0) - a.price * (a.quantity || 0))
    .map((s) => s.marketHashName)
    .slice(0, limit);
}

async function runCollection({ config, store, live = true }) {
  const timestamp = new Date().toISOString();
  const fx = await fetchFxRate(config.currency.base, config);
  const results = { timestamp, fx, sources: {} };
  const existing = store.loadItems();

  try {
    const names = sources.discoverSourceNames();
    const catalogSources = names.filter((n) => (config.sources[n] || {}).role !== "per-item");
    const perItemSources = names.filter((n) => (config.sources[n] || {}).role === "per-item");

    // 1) Collect all enabled catalog sources generically.
    const catalogSnapshotsPerSource = {};
    for (const name of catalogSources) {
      const srcCfg = config.sources[name];
      if (!srcCfg || srcCfg.enabled === false) {
        results.sources[name] = { ok: false, note: { reason: "disabled" } };
        continue;
      }
      const res = await sources.collectSource(name, config, fx, timestamp, { forceFixture: !live });
      catalogSnapshotsPerSource[name] = res.ok ? res.normalized : [];
      results.sources[name] = {
        ok: res.ok,
        items: res.normalized.length,
        parsedCount: res.parsedCount,
        note: res.note,
      };
    }

    const allCatalog = [];
    for (const name of Object.keys(catalogSnapshotsPerSource)) {
      allCatalog.push(...catalogSnapshotsPerSource[name]);
    }

    // 2) Pick a reference universe: first enabled catalog source with data
    //    that is configured as a candidate feeder (steam.priceFilterSource).
    let referenceSnapshots = allCatalog;
    const refSource = (config.sources.steam && config.sources.steam.priceFilterSource) || "lootfarm";
    if (catalogSnapshotsPerSource[refSource] && catalogSnapshotsPerSource[refSource].length) {
      referenceSnapshots = catalogSnapshotsPerSource[refSource];
    }

    if (referenceSnapshots.length === 0) {
      return { ok: false, error: "no catalog data collected", results };
    }

    // 3) Collect enabled per-item sources generically, feeding candidates.
    let state = buildStateFromSnapshots(allCatalog, {});
    for (const name of perItemSources) {
      const srcCfg = config.sources[name];
      if (!srcCfg || srcCfg.enabled === false) {
        results.sources[name] = { ok: false, note: { reason: "disabled" } };
        continue;
      }
      const candidates = selectCandidates(referenceSnapshots, config, name);
      const res = await sources.collectSource(name, config, fx, timestamp, {
        forceFixture: !live,
        candidates,
      });
      results.sources[name] = {
        ok: res.ok,
        items: res.normalized.length,
        parsedCount: res.parsedCount,
        note: res.note,
      };
      if (res.ok) {
        state = buildStateFromSnapshots(res.normalized, state);
      }
    }

    // 4) Merge catalog snapshots into state (already partially done above).
    store.saveItems(state);

    // 5) History append per item.
    writeHistory(store, state, timestamp, results.sources);

    // 6) Opportunity engine.
    const opp = runOpportunityEngine(state, config, results.sources);
    store.saveOpportunities(opp.opportunities, { summary: opp.summary });
    results.opportunities = opp.summary;

    const meta = {
      lastRun: timestamp,
      fx,
      sources: results.sources,
      stats: {
        items: Object.keys(state).length,
        withSteam: countWith(state, "steam"),
        withLootFarm: countWith(state, "lootfarm"),
        opportunities: opp.summary.opportunitiesDetected,
      },
    };
    store.saveMeta(meta);
    results.state = state;
    return { ok: true, results };
  } catch (error) {
    return { ok: false, error: error.message, results };
  }
}

function countWith(state, source) {
  let n = 0;
  for (const key of Object.keys(state)) {
    if (state[key].sources && state[key].sources[source]) n += 1;
  }
  return n;
}

function writeHistory(store, state, timestamp, sourceResults) {
  const stamp = timestamp;
  let written = 0;
  for (const key of Object.keys(state)) {
    const item = state[key];
    const sourcesView = {};
    for (const src of Object.keys(item.sources || {})) {
      const s = item.sources[src];
      if (!s || !s.timestamp) continue;
      sourcesView[src] = {
        priceRub: s.priceRub != null ? s.priceRub : s.sellRub != null ? s.sellRub : s.buyRub,
        sellRub: s.sellRub != null ? s.sellRub : null,
        buyRub: s.buyRub != null ? s.buyRub : null,
        timestamp: s.timestamp,
      };
    }
    if (Object.keys(sourcesView).length === 0) continue;
    store.appendHistory(key, { t: stamp, item: item.marketHashName, sources: sourcesView });
    written += 1;
  }
  return written;
}

function loadProductState(config, store) {
  return store.loadItems();
}

module.exports = {
  runCollection,
  buildStateFromSnapshots,
  selectCandidates,
  writeHistory,
  loadProductState,
  countWith,
};
