"use strict";

const { evaluateOpportunity } = require("./analytics");

/**
 * Opportunity engine — universal layer. Consumes canonical item state and
 * runs configured strategies. No source-specific logic here.
 */

function buildStrategies(config) {
  return [
    {
      id: "marketplace-to-steam",
      enabled: config.opportunities.enabled,
      entrySource: "lootfarm",
      exitSource: "steam",
      entryType: "BUY",
      exitType: "SELL",
    },
  ];
}

function filterOpportunity(opp, config) {
  const o = config.opportunities;
  if (opp.status !== "OK") return false;
  const staleMs = o.staleMaxMinutes * 60 * 1000;
  if (Number.isFinite(staleMs) && staleMs > 0) {
    const now = Date.now();
    const ts = Date.parse(opp.timestamp);
    if (Number.isFinite(ts) && now - ts > staleMs) return false;
  }
  if (opp.roi != null && o.minRoiPct != null && opp.roi < o.minRoiPct) return false;
  if (opp.netProfit != null && o.minProfitRub != null && opp.netProfit < o.minProfitRub) return false;
  if (opp.liquidity && o.minSellDepthRub != null && opp.liquidity.money < o.minSellDepthRub) return false;
  return true;
}

function runOpportunityEngine(state, config, meta) {
  const strategies = buildStrategies(config);
  const now = new Date().toISOString();
  const opportunities = [];
  const skipped = { count: 0, reasons: {} };

  for (const key of Object.keys(state)) {
    const item = state[key];
    const sources = item.sources || {};
    for (const strategy of strategies) {
      if (!strategy.enabled) continue;
      const entry = sources[strategy.entrySource];
      const exit = sources[strategy.exitSource];
      if (!entry || !exit) continue;

      const entryPriceRub =
        entry.priceRub != null
          ? entry.priceRub
          : entry.price && entry.currency === config.currency.base
            ? entry.price
            : null;
      if (entryPriceRub == null) {
        skipped.count += 1;
        skipped.reasons["NO_ENTRY_PRICE"] = (skipped.reasons["NO_ENTRY_PRICE"] || 0) + 1;
        continue;
      }

      // Marketplace -> Steam: SELL INTO STEAM BUY ORDERS.
      // Exit reference is the best Steam BUY order (highestBuy), never the ask,
      // and exit depth is the buy-order book. Documented in
      // STRATEGY_MARKETPLACE_TO_STEAM.md: "Exit economics uses only buyLevels".
      const exitBuyerPaysRub = exit.buyRub != null ? exit.buyRub : null;
      if (exitBuyerPaysRub == null) {
        skipped.count += 1;
        skipped.reasons["NO_EXIT_PRICE"] = (skipped.reasons["NO_EXIT_PRICE"] || 0) + 1;
        continue;
      }

      const opp = evaluateOpportunity({
        itemKey: key,
        itemName: item.marketHashName,
        entryPriceRub,
        entryQuantity: entry.quantity,
        exitBuyerPaysRub,
        exitLevels: exit.buyLevels,
        entrySource: strategy.entrySource,
        exitSource: strategy.exitSource,
        feeModel: config.feeModel[strategy.exitSource],
        timestamp: now,
      });
      if (opp.status === "OK" && filterOpportunity(opp, config)) {
        opp.strategy = strategy.id;
        opportunities.push(opp);
      } else {
        skipped.count += 1;
        const r = opp.status || "FILTERED";
        skipped.reasons[r] = (skipped.reasons[r] || 0) + 1;
      }
    }
  }

  const sorted = opportunities.sort((a, b) => (b.score || 0) - (a.score || 0));
  const top = sorted.slice(0, config.opportunities.topN || 100);

  const summary = {
    totalItems: Object.keys(state).length,
    opportunitiesDetected: opportunities.length,
    opportunitiesReturned: top.length,
    skipped,
    generatedAt: now,
  };

  return { summary, opportunities: top };
}

function addOppMeta(latest, meta) {
  return latest;
}

module.exports = {
  runOpportunityEngine,
  buildStrategies,
  filterOpportunity,
};