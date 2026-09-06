"use strict";

/**
 * LIS-SKINS parser — raw export -> stable technical record.
 *
 * Maps the public export contract to a neutral parsed shape; the normalizer
 * (not this file) decides currency/price semantics.
 */
function parseLisSkins(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item.name !== "string" || item.name.trim() === "") continue;
    out.push({
      marketHashName: item.name,
      priceUsd: Number.isFinite(item.price) ? item.price : null,
      unlockedPriceUsd: Number.isFinite(item.unlocked_price) ? item.unlocked_price : null,
      count: Number.isFinite(item.count) ? item.count : 0,
      url: typeof item.url === "string" ? item.url : null,
    });
  }
  return out;
}

module.exports = { parseLisSkins };