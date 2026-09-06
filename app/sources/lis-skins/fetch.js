"use strict";

/**
 * LIS-SKINS connector — LIVE source adapter.
 *
 * External contract (public bulk export, no auth):
 *   GET https://lis-skins.com/market_export_json/csgo.json
 *
 * Response: JSON array of item-level aggregates (one record per market hash
 * name). Confirmed live (HTTP 200):
 *   [
 *     {
 *       "name": "AK-47 | Redline (Field-Tested)",   // market hash name
 *       "price": 27.43,                             // USD, decimal units
 *       "unlocked_price": 27.43,                    // USD; nullable
 *       "url": "https://app.lis-skins.com/...",     // page url
 *       "count": 2544                               // aggregated listing stock
 *     }
 *   ]
 *
 * Verified in this environment: 23,938 records, price is USD decimal units
 * (e.g. AK-47 Redline FT = 27.43 USD), `count` = listings aggregated under the
 * name. `unlocked_price` equals `price` when no trade-locked stock is present.
 *
 * Per-game exports: csgo.json, rust.json, dota2.json (all public).
 * The `/api/market/*` endpoints are Cloudflare-protected; the export is not.
 *
 * HTTP / retry / backoff live only here (AGENTS.md §15).
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function fetchRawCatalog({ url, timeoutMs = 30000, retries = 2, backoffMs = 3000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json", "User-Agent": UA },
      });
      clearTimeout(timer);
      if (res.status === 403 || res.status === 429) {
        throw new Error(`lis-skins HTTP ${res.status} (blocked/rate-limited)`);
      }
      if (!res.ok) throw new Error(`lis-skins HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error("lis-skins: expected array");
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error("lis-skins: fetch failed");
}

module.exports = { fetchRawCatalog };