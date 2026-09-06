"use strict";

/**
 * Fee model. Steam CS2 sale fee is reused from the verified algorithm
 * developed in ZOD (profitability/steam-cs2-fee.js) and validated against
 * Steam's published fee rules (5% + 10%, min fee 0.01 minor unit).
 */

function steamFeeSellerReceives(buyerPays, feeModel = {}) {
  const steamFeeRate = feeModel.sellFeeRate ?? 0.05;
  const gameFeeRate = feeModel.gameFeeRate ?? 0.1;
  const minMinor = feeModel.minFeeMinorUnits ?? 1;

  const crate = (sellerReceives) => {
    const steamFee = Math.max(minMinor, Math.floor(sellerReceives * steamFeeRate));
    const gameFee = Math.max(minMinor, Math.floor(sellerReceives * gameFeeRate));
    return {
      sellerReceives,
      steamFee,
      gameFee,
      totalFee: steamFee + gameFee,
      buyerPays: sellerReceives + steamFee + gameFee,
    };
  };

  const buyerPaysMinor = Math.round(buyerPays * 100);
  let low = 0;
  let high = buyerPaysMinor;
  let best = crate(0);
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = crate(mid);
    if (candidate.buyerPays <= buyerPaysMinor) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const rounding = buyerPaysMinor - best.buyerPays;

  return {
    buyerPays,
    sellerReceives: best.sellerReceives / 100,
    steamFee: (best.steamFee + rounding) / 100,
    gameFee: best.gameFee / 100,
    totalFee: (best.totalFee + rounding) / 100,
  };
}

function buildFeeSummary({ source, buyerPays, feeModel }) {
  if (buyerPays == null || buyerPays <= 0) {
    return { available: false, reason: "NO_PRICE" };
  }
  return {
    available: true,
    source,
    feeKnown: !feeModel.unknown,
    ...steamFeeSellerReceives(buyerPays, feeModel),
  };
}

module.exports = { steamFeeSellerReceives, buildFeeSummary };