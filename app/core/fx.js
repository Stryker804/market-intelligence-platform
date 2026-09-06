"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * USD -> BASE currency rate provider.
 * Live source: https://open.er-api.com/v6/latest/USD (used in research).
 * Falls back to the last cached value, then to config fallback.
 */

const FX_URL = "https://open.er-api.com/v6/latest/USD";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

async function fetchFxRate(baseCurrency, config) {
  if (baseCurrency === "USD") {
    return { base: baseCurrency, rate: 1, source: "fixed", cached: false, cachedAt: null, rates: {} };
  }
  let cached = null;
  try {
    cached = JSON.parse(fs.readFileSync(config.currency.fx.cacheFile, "utf8"));
  } catch {
    cached = null;
  }

  const freshEnough =
    cached &&
    cached.base === baseCurrency &&
    cached.cachedAt &&
    Date.now() - Date.parse(cached.cachedAt) < CACHE_TTL_MS;
  if (freshEnough && !config.currency.fx.live) {
    return { base: baseCurrency, rate: cached.rate, source: "cache", cached: true, cachedAt: cached.cachedAt, rates: cached.rates || {} };
  }

  if (config.currency.fx.live) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(FX_URL, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`fx HTTP ${res.status}`);
      const body = await res.json();
      const rate = Number(body.rates && body.rates[baseCurrency]);
      if (Number.isFinite(rate) && rate > 0) {
        const record = { base: baseCurrency, rate, cachedAt: new Date().toISOString(), rates: body.rates || {} };
        try {
          fs.mkdirSync(path.dirname(config.currency.fx.cacheFile), { recursive: true });
          fs.writeFileSync(
            config.currency.fx.cacheFile + ".tmp",
            JSON.stringify(record),
            "utf8",
          );
          fs.renameSync(config.currency.fx.cacheFile + ".tmp", config.currency.fx.cacheFile);
        } catch {
          /* non-fatal */
        }
        return { base: baseCurrency, rate, source: "live", cached: false, cachedAt: null, rates: record.rates };
      }
    } catch {
      /* fall through to cache */
    }
  }

  if (cached && Number.isFinite(cached.rate) && cached.rate > 0) {
    return { base: baseCurrency, rate: cached.rate, source: "cache", cached: true, cachedAt: cached.cachedAt, rates: cached.rates || {} };
  }
  return {
    base: baseCurrency,
    rate: config.currency.fx.fallbackUsdRub,
    source: "fallback",
    cached: false,
    cachedAt: null,
    rates: {},
  };
}

/**
 * Convert amount between currencies.
 * fx may be either a USD->base rate (number, backward compatible) or an
 * fx object { rate, rates }. Non-USD cross rates go through a USD bridge.
 */
function convert(amount, fromCurrency, toCurrency, fx) {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (fromCurrency === toCurrency) return amount;
  const rate = (fx && typeof fx === "object" && fx) || {};
  const usdToBase = typeof fx === "number" ? fx : rate.rate;
  if (!Number.isFinite(usdToBase) || usdToBase <= 0) return null;
  if (fromCurrency === "USD") return amount * usdToBase;
  if (toCurrency === "USD") return amount / usdToBase;
  const fromRate = rate.rates && Number(rate.rates[fromCurrency]);
  if (Number.isFinite(fromRate) && fromRate > 0) {
    const usdAmount = amount / fromRate;
    return usdAmount * usdToBase;
  }
  return null;
}

module.exports = { fetchFxRate, convert };