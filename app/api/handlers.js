"use strict";

const { analyzeSpread } = require("../core/analytics");
const { analyzeItemHistory } = require("../core/history-analytics");
const { identityWithSafeName } = require("../core/canonical");

/**
 * API handler implementations. Pure data access over the store — no I/O
 * beyond file reads. All values derive from real stored state.
 */
function createHandlers({ config, store }) {
  const meta = () => store.loadMeta();
  const state = () => store.loadItems();
  const opp = () => store.loadOpportunities();
  const fxView = (fx) =>
    fx
      ? { base: fx.base || null, rate: fx.rate, source: fx.source, cached: fx.cached === true, cachedAt: fx.cachedAt }
      : null;

  return {
    config() {
      return {
        currency: config.currency,
        sources: summarizeSourceConfig(config.sources),
        feeModel: config.feeModel,
        opportunities: config.opportunities,
        filters: config.filters,
        collection: config.collection,
      };
    },

    sources() {
      const m = meta();
      const out = [];
      for (const name of Object.keys(config.sources)) {
        const src = config.sources[name];
        const status = (m.sources || {})[name] || null;
        const ok = status && status.ok === true;
        out.push({
          name,
          enabled: src.enabled !== false,
          available: ok,
          status: ok ? "OK" : status ? (status.ok === false ? "UNAVAILABLE" : "NO_DATA") : "NO_DATA",
          lastRun: status ? status.note && status.note.source === "fixture" ? { fixture: true } : null : null,
          lastItems: status ? (status.items != null ? status.items : null) : null,
          note: status ? status.note : null,
          error: status && status.note ? status.note.error || status.note.reason || null : null,
        });
      }
      return {
        generatedAt: m.lastRun,
        fx: fxView(m.fx),
        sources: out,
      };
    },

    stats() {
      const items = state();
      const m = meta();
      const oppData = opp();
      let withSteam = 0;
      let withLootFarm = 0;
      let withCross = 0;
      for (const key of Object.keys(items)) {
        const s = items[key].sources || {};
        if (s.steam) withSteam += 1;
        if (s.lootfarm) withLootFarm += 1;
        if (s.steam && s.lootfarm) withCross += 1;
      }
      return {
        items: Object.keys(items).length,
        withSteam,
        withLootFarm,
        withCross,
        opportunities: oppData.summary ? oppData.summary.opportunitiesDetected : (oppData.opportunities || []).length,
        lastRun: m.lastRun,
        fx: fxView(m.fx),
        generatedAt: oppData.generatedAt || null,
      };
    },

    markets(searchParams) {
      const items = state();
      const q = (searchParams.get("q") || "").trim().toLowerCase();
      const category = (searchParams.get("category") || "").trim().toLowerCase();
      const hasSource = (searchParams.get("source") || "").trim().toLowerCase();
      const minPrice = parseFloat(searchParams.get("minPrice"));
      const maxPrice = parseFloat(searchParams.get("maxPrice"));
      const limit = parseInt(searchParams.get("limit") || "200", 10) || 200;
      const offset = parseInt(searchParams.get("offset") || "0", 10) || 0;

      const rows = [];
      for (const key of Object.keys(items)) {
        const item = items[key];
        const s = item.sources || {};
        const lf = s.lootfarm;
        const st = s.steam;

        if (q && !(item.marketHashName || "").toLowerCase().includes(q)) continue;
        if (category && !(item.category || "").toLowerCase().includes(category)) continue;
        if (hasSource && !s[hasSource]) continue;

        const lfRub = lf ? (lf.priceRub != null ? lf.priceRub : null) : null;
        const stSell = st ? st.sellRub : null;
        const stBuy = st ? st.buyRub : null;
        const price = lfRub != null ? lfRub : stSell;
        if (Number.isFinite(minPrice) && (price == null || price < minPrice)) continue;
        if (Number.isFinite(maxPrice) && (price == null || price > maxPrice)) continue;

        const steamSpread = analyzeSpread(stBuy, stSell);
        rows.push({
          identityKey: key,
          itemName: item.marketHashName,
          exterior: item.exterior || null,
          category: item.category || null,
          game: item.game || null,
          lootfarmBuy: lfRub,
          lootfarmQty: lf ? lf.quantity : null,
          steamSell: stSell,
          steamBuy: stBuy,
          steamSellQty: st ? st.sellQuantity : null,
          steamBuyQty: st ? st.buyQuantity : null,
          steamSpreadPct: steamSpread.available ? steamSpread.spreadPercent : null,
          marketSpreadExitPct:
            lfRub != null && stBuy != null
              ? ((stBuy - lfRub) / lfRub) * 100
              : null,
          marketVsSellPct:
            lfRub != null && stSell != null
              ? ((stSell - lfRub) / lfRub) * 100
              : null,
          updatedAt: maxTs(lf, st),
        });
      }

      rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      const total = rows.length;
      const page = rows.slice(offset, offset + limit);
      return { rows: page, total, offset, limit };
    },

    item(key) {
      const items = state();
      const item = items[key];
      if (!item) {
        return { error: "item not found", identityKey: key };
      }
      const history = store.readHistory(key, 400);
      return {
        identityKey: key,
        item: item,
        sources: item.sources || {},
        history: history,
        historyCount: history.length,
        trend: {
          lootfarm: analyzeItemHistory(history, "sources.lootfarm.priceRub"),
          steamBuy: analyzeItemHistory(history, "sources.steam.buyRub"),
        },
        computed: computeItemMetrics(item),
      };
    },

    history(key) {
      const history = store.readHistory(key, 2000);
      return { identityKey: key, entries: history };
    },

    arbitrage(searchParams) {
      const data = opp();
      let list = (data.opportunities || []).slice();
      const limit = parseInt(searchParams.get("limit") || "100", 10) || 100;
      const minScore = parseFloat(searchParams.get("minScore") || "0");
      if (Number.isFinite(minScore) && minScore > 0) {
        list = list.filter((o) => (o.score || 0) >= minScore);
      }
      const q = (searchParams.get("q") || "").trim().toLowerCase();
      if (q) list = list.filter((o) => (o.itemName || "").toLowerCase().includes(q));
      return {
        generatedAt: data.generatedAt,
        summary: data.summary,
        opportunities: list.slice(0, limit),
      };
    },

    fx() {
      const m = meta();
      return { fx: fxView(m.fx), config: config.currency };
    },
  };
}

function summarizeSourceConfig(sources) {
  const out = [];
  for (const name of Object.keys(sources)) {
    out.push({
      name,
      enabled: sources[name].enabled !== false,
      url: sources[name].url || sources[name].endpoint || null,
    });
  }
  return out;
}

function maxTs(...objs) {
  let max = null;
  for (const o of objs) {
    if (o && o.timestamp) {
      const t = Date.parse(o.timestamp);
      if (Number.isFinite(t) && (max == null || t > max)) max = t;
    }
  }
  return max ? new Date(max).toISOString() : null;
}

function computeItemMetrics(item) {
  const s = item.sources || {};
  const lf = s.lootfarm;
  const st = s.steam;
  if (!lf || !st) return null;
  const entry = lf.priceRub;
  if (entry == null) return null;
  return {
    marketplaceVsSteamExitPct:
      st.buyRub != null ? ((st.buyRub - entry) / entry) * 100 : null,
    marketplaceVsSteamAskPct:
      st.sellRub != null ? ((st.sellRub - entry) / entry) * 100 : null,
    steamBidAskPct:
      st.buyRub != null && st.sellRub != null
        ? ((st.sellRub - st.buyRub) / st.buyRub) * 100
        : null,
  };
}

module.exports = createHandlers;