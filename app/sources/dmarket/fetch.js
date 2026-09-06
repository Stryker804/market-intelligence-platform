"use strict";

/**
 * DMarket connector — LIVE source adapter.
 *
 * External contract (public, no API key):
 *   GET https://api.dmarket.com/marketplace-api/v2/prices?GameID=a8db&Limit=20
 *
 * Response (confirmed live HTTP 200):
 *   {
 *     "Items": [
 *       { "Title": "AK-47 | Black Laminate (Battle-Scarred)", "GameID": "a8db",
 *         "Price": { "Currency": "USD", "Amount": 36.81 } }
 *     ],
 *     "Total": "N"
 *   }
 *
 * Notes (verified live):
 *   - GameID is case-sensitive uppercase; `a8db` == CS2.
 *   - `currency` / `offset` / `orderBy` params are IGNORED anonymously — the
 *     endpoint always returns USD and a leading slice of the catalog.
 *   - No stock/quantity, no objectId, no discount, no buyback, no trade lock.
 *   - Anonymous rate limit (response headers): ~12 req/sec per IP.
 *
 * HTTP / retry / backoff / throttling live only here (AGENTS.md §15).
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function fetchRawPrices({ url, gameId = "a8db", limit = 20, timeoutMs = 20000, retries = 2, backoffMs = 1500 } = {}) {
  const params = new URLSearchParams({ GameID: gameId, Limit: String(limit) });
  const fullUrl = `${url}?${params.toString()}`;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(fullUrl, {
        signal: controller.signal,
        headers: { Accept: "application/json", "User-Agent": UA },
      });
      clearTimeout(timer);
      if (res.status === 403 || res.status === 429) {
        throw new Error(`dmarket HTTP ${res.status} (blocked/rate-limited)`);
      }
      if (!res.ok) throw new Error(`dmarket HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !Array.isArray(data.Items)) throw new Error("dmarket: expected {Items: []}");
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error("dmarket: fetch failed");
}

module.exports = { fetchRawPrices };