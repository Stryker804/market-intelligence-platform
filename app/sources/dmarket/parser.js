"use strict";

/**
 * DMarket parser — raw v2/prices response -> stable technical records.
 */
function parseDMarket(raw) {
  if (!raw || !Array.isArray(raw.Items)) return [];
  const out = [];
  for (const item of raw.Items) {
    if (!item || typeof item.Title !== "string" || item.Title.trim() === "") continue;
    const price = item.Price && item.Price.Amount;
    out.push({
      marketHashName: item.Title,
      priceUsd: Number.isFinite(price) ? price : null,
      priceCurrency: item.Price && typeof item.Price.Currency === "string" ? item.Price.Currency : "USD",
      gameId: item.GameID || null,
    });
  }
  return out;
}

module.exports = { parseDMarket };