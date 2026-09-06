"use strict";

const { steamFeeSellerReceives } = require("./fees");

/**
 * Universal analytics over the canonical model. No source specifics here:
 * input is the internal item state + fee model.
 */

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function analyzeSpread(buyPrice, sellPrice) {
  const buy = safeNumber(buyPrice);
  const sell = safeNumber(sellPrice);
  if (buy == null || buy <= 0) return { available: false, reason: "INVALID_BEST_BUY" };
  if (sell == null || sell <= 0) return { available: false, reason: "INVALID_BEST_SELL" };
  if (sell < buy) return { available: false, reason: "INVALID_SPREAD_ORDER" };
  const spread = sell - buy;
  return {
    available: true,
    bestBuy: buy,
    bestSell: sell,
    spread,
    spreadPercent: (spread / buy) * 100,
  };
}

/**
 * Liquidity of a sell-side level book: total units and total money within
 * `maxSlippagePct` above the best sell, and the executable fill depth for a
 * given buy quantity (weighted average price while filling `quantity` units).
 */
function analyzeLiquidity(levels, { maxSlippagePct = 5 } = {}) {
  if (!Array.isArray(levels) || levels.length === 0) {
    return { available: false, reason: "NO_LEVELS" };
  }
  const best = levels[0].price;
  if (!Number.isFinite(best) || best <= 0) return { available: false, reason: "INVALID_LEVEL" };
  const capPrice = best * (1 + maxSlippagePct / 100);
  let units = 0;
  let money = 0;
  for (const lvl of levels) {
    if (!Number.isFinite(lvl.price) || !Number.isFinite(lvl.quantity)) continue;
    if (lvl.price > capPrice) break;
    units += lvl.quantity;
    money += lvl.price * lvl.quantity;
  }
  if (units <= 0) return { available: false, reason: "NO_LIQUIDITY_WITHIN_SLIPPAGE" };
  return {
    available: true,
    bestPrice: best,
    units,
    money,
    capPrice,
  };
}

/**
 * Weighted-average fill price for buying `quantity` units from a level book.
 * Returns { avgPrice, filledUnits } or null when depth is insufficient.
 */
function fillLevels(levels, quantity) {
  if (!Array.isArray(levels) || quantity <= 0) return null;
  let remaining = quantity;
  let total = 0;
  let filled = 0;
  for (const lvl of levels) {
    const qty = Math.min(remaining, lvl.quantity);
    total += qty * lvl.price;
    filled += qty;
    remaining -= qty;
    if (remaining <= 0) break;
  }
  if (filled <= 0) return null;
  return { avgPrice: total / filled, filledUnits: filled };
}

/**
 * Evaluate one opportunity: buy at entryRub (per unit), sell on exit market
 * where buyer pays exitBuyerPaysRub; seller receives after exit fees.
 */
function evaluateOpportunity({
  itemKey,
  itemName,
  entryPriceRub,
  entryQuantity,
  exitBuyerPaysRub,
  exitLevels,
  entrySource,
  exitSource,
  feeModel,
  timestamp,
}) {
  const entry = safeNumber(entryPriceRub);
  const exit = safeNumber(exitBuyerPaysRub);
  if (entry == null || entry <= 0) {
    return { itemKey, status: "NO_ENTRY_PRICE" };
  }
  if (exit == null || exit <= 0) {
    return { itemKey, status: "NO_EXIT_PRICE" };
  }

  const fee = steamFeeSellerReceives(exit, feeModel || {});
  const sellerReceives = fee.sellerReceives;
  const grossProfitPerUnit = sellerReceives - entry;
  const grossROI = (grossProfitPerUnit / entry) * 100;

  const liq = analyzeLiquidity(exitLevels, {});
  let executableQty = safeNumber(entryQuantity) || 0;
  // Full-execution requirement from STRATEGY_MARKETPLACE_TO_STEAM.md:
  // never claim an executable quantity larger than the exit buy-order depth.
  if (executableQty > 0 && liq.available && liq.units < executableQty) {
    executableQty = liq.units;
  }
  let capitalAtBest = entry * executableQty;
  let roi = null;
  let netProfit = 0;
  let result = {
    itemKey,
    status: "OK",
    itemName,
    entrySource,
    exitSource,
    entryPriceRub: round2(entry),
    exitBuyerPaysRub: round2(exit),
    sellerReceivesRub: round2(sellerReceives),
    entryFeeRub: 0,
    exitFeeRub: round2(fee.totalFee),
    totalFeesRub: round2(fee.totalFee),
    grossProfitPerUnit: round2(grossProfitPerUnit),
    grossROI: round2(grossROI),
    liquidity: liq.available
      ? { bestPrice: round2(liq.bestPrice), units: liq.units, money: round2(liq.money) }
      : null,
  };

  if (executableQty <= 0) {
    // No real marketplace supply to buy. Report honestly instead of
    // fabricating an executable quantity / profit for a zero-stock item.
    result.status = "NO_EXECUTABLE_QTY";
    result.execution = {
      note: "no executable entry quantity (marketplace stock is zero or unknown)",
    };
  } else {
    capitalAtBest = entry * executableQty;
    netProfit = grossProfitPerUnit * executableQty;
    roi = capitalAtBest > 0 ? (netProfit / capitalAtBest) * 100 : null;

    if (liq.available && exit < liq.bestPrice * (1 + fee.totalFee / exit)) {
      result.execution = {
        note: "exit demand is very close to entry price; slippage may consume profit",
      };
    }
    if (netProfit <= 0) result.status = "NO_PROFIT";
  }

  result.executableQuantity = executableQty;
  result.capitalRequired = round2(capitalAtBest);
  result.netProfit = round2(netProfit);
  result.roi = round2(roi);
  result.score = opportunityScore({
    roiPct: roi,
    profitRub: netProfit,
    liquidityRub: liq.available ? liq.money : 0,
  });

  return {
    ...result,
    timestamp: timestamp || new Date().toISOString(),
  };
}

/**
 * Composite opportunity score 0..100:
 *  - up to 50 pts from ROI (compressed with log)
 *  - up to 30 pts from absolute profit
 *  - up to 20 pts from liquidity
 */
function opportunityScore({ roiPct, profitRub, liquidityRub }) {
  let s = 0;
  const roi = safeNumber(roiPct);
  if (roi != null && roi > 0) {
    s += Math.min(50, Math.log10(1 + roi) * 22);
  }
  const profit = safeNumber(profitRub);
  if (profit != null && profit > 0) {
    s += Math.min(30, Math.log10(1 + profit) * 8);
  }
  const liq = safeNumber(liquidityRub);
  if (liq != null && liq > 0) {
    s += Math.min(20, Math.log10(1 + liq) * 3);
  }
  return Math.round(s);
}

function round2(v) {
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

module.exports = {
  analyzeSpread,
  analyzeLiquidity,
  fillLevels,
  evaluateOpportunity,
  opportunityScore,
  round2,
};