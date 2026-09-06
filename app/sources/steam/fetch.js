"use strict";

/**
 * Steam connector — LIVE source adapter.
 * Endpoint: GET https://steamcommunity.com/market/orderbook?q=Load&qp=["730", <name>]
 * Response prices are in the account-region currency's minor units (x100).
 */

async function fetchSteamOrderbook(marketHashName, { url, timeoutMs = 20000 } = {}) {
  const target = new URL(url);
  target.searchParams.set("q", "Load");
  target.searchParams.set("qp", JSON.stringify(["730", marketHashName]));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(target.toString(), {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
    });
    if (!res.ok) throw new Error(`steam HTTP ${res.status}`);
    return await res.json();
  } catch (error) {
    const out = new Error(`steam orderbook fetch failed for ${marketHashName}: ${error.message}`);
    out.code = error.name === "AbortError" ? "ETIMEDOUT" : "EFETCH";
    throw out;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchSteamOrderbook };