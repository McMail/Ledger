/**
 * taxCalculator.js — ATO resident individual tax estimate.
 * Brackets are stored per financial year so this is a one-place edit each July.
 * Source checked against ato.gov.au "Individual income tax rates" for FY2025-26.
 * NOTE: this is a general estimate for resident individuals only. It does not
 * model HECS/HELP repayments, private health insurance rebate/surcharge,
 * Medicare low-income full/partial exemption thresholds, or offsets other
 * than LITO. Not tax advice.
 */
const TaxCalculator = (() => {

  const BRACKETS_BY_YEAR = {
    'FY2025-26': [
      { min: 0,       max: 18200,  rate: 0    },
      { min: 18200,   max: 45000,  rate: 0.16 },
      { min: 45000,   max: 135000, rate: 0.30 },
      { min: 135000,  max: 190000, rate: 0.37 },
      { min: 190000,  max: null,   rate: 0.45 },
    ],
    // Legislated: 16% bracket drops to 15% from 1 July 2026.
    'FY2026-27': [
      { min: 0,       max: 18200,  rate: 0    },
      { min: 18200,   max: 45000,  rate: 0.15 },
      { min: 45000,   max: 135000, rate: 0.30 },
      { min: 135000,  max: 190000, rate: 0.37 },
      { min: 190000,  max: null,   rate: 0.45 },
    ],
  };

  const MEDICARE_LEVY_RATE = 0.02;

  function incomeTax(taxableIncome, year = 'FY2025-26') {
    const brackets = BRACKETS_BY_YEAR[year] || BRACKETS_BY_YEAR['FY2025-26'];
    let tax = 0;
    const perBracket = [];

    for (const b of brackets) {
      const upper = b.max === null ? taxableIncome : Math.min(taxableIncome, b.max);
      const taxableInBand = Math.max(0, upper - b.min);
      const taxInBand = taxableInBand * b.rate;
      tax += taxInBand;
      perBracket.push({ ...b, taxableInBand, taxInBand });
      if (b.max !== null && taxableIncome <= b.max) break;
    }
    return { tax, perBracket };
  }

  /** Low Income Tax Offset — standard ATO formula. */
  function lito(taxableIncome) {
    if (taxableIncome <= 37500) return 700;
    if (taxableIncome <= 45000) return Math.max(0, 700 - (taxableIncome - 37500) * 0.05);
    if (taxableIncome <= 66667) return Math.max(0, 325 - (taxableIncome - 45000) * 0.015);
    return 0;
  }

  function estimate(taxableIncome, year = 'FY2025-26') {
    taxableIncome = Math.max(0, taxableIncome || 0);
    const { tax, perBracket } = incomeTax(taxableIncome, year);
    const offset = lito(taxableIncome);
    const taxAfterOffset = Math.max(0, tax - offset);
    const medicare = taxableIncome * MEDICARE_LEVY_RATE;
    const total = taxAfterOffset + medicare;
    const effectiveRate = taxableIncome > 0 ? total / taxableIncome : 0;

    return {
      taxableIncome,
      grossIncomeTax: tax,
      lito: offset,
      incomeTaxAfterOffset: taxAfterOffset,
      medicareLevy: medicare,
      total,
      effectiveRate,
      perBracket,
    };
  }

  return { estimate, BRACKETS_BY_YEAR };
})();
