/**
 * categorizer.js — decides two independent things per transaction:
 *
 *  A) `category` — where the money is going:
 *     - transfers   : matched pair between your two accounts (excluded from income)
 *     - savings     : money landing in your savings account with no matching
 *                     transfer leg (interest, a direct deposit, a manual top-up)
 *     - income      : money landing in your spending account with no matching
 *                     transfer leg
 *     - spending    : any debit that isn't part of a matched transfer
 *     - uncategorized (manual only — nothing auto-assigns this)
 *
 *  B) `businessTag` — a tax-relevant flag, independent of category. A
 *     transaction can be "spending" AND tax-flagged at the same time. This
 *     is what you'll filter by at tax time, regardless of which category
 *     each transaction ended up in.
 *
 * Manual overrides (`manualCategory` / `manualBusinessTag`) always win and
 * are never recomputed.
 */
const Categorizer = (() => {

  const TRANSFER_WINDOW_DAYS = 3;

  const DEFAULT_SETTINGS = {
    businessKeywords: ['invoice', 'contractor', 'freelance', 'consulting', 'client payment'],
    whitelistKeywords: [],
    largeAmountThreshold: 80,
    categories: ['income', 'savings', 'transfers', 'spending', 'uncategorized'],
  };

  function dayDiff(a, b) {
    return Math.abs((new Date(a) - new Date(b)) / 86400000);
  }

  /** Mutates transactions in place, setting .category = 'transfers' for matched pairs. */
  function detectTransfers(transactions) {
    const spending = transactions.filter(t => t.accountId === 'spending' && !t.manualCategory);
    const savings = transactions.filter(t => t.accountId === 'savings' && !t.manualCategory);

    for (const a of spending) {
      if (a.category === 'transfers') continue;
      for (const b of savings) {
        if (b.category === 'transfers') continue;
        const sameMagnitude = Math.abs(Math.abs(a.amount) - Math.abs(b.amount)) < 0.01;
        const oppositeSign = (a.amount > 0) !== (b.amount > 0);
        const closeInTime = dayDiff(a.date, b.date) <= TRANSFER_WINDOW_DAYS;
        if (sameMagnitude && oppositeSign && closeInTime) {
          a.category = 'transfers';
          b.category = 'transfers';
          a.isTransferPair = b.id;
          b.isTransferPair = a.id;
          break;
        }
      }
    }
  }

  function matchesKeywords(description, keywords) {
    const desc = description.toLowerCase();
    return keywords.some(k => k && desc.includes(k.toLowerCase()));
  }

  /**
   * Categorise a full list of transactions.
   * `settings` = { businessKeywords, whitelistKeywords, largeAmountThreshold }
   */
  function categorize(transactions, settings = {}) {
    const businessKeywords = settings.businessKeywords || DEFAULT_SETTINGS.businessKeywords;
    const whitelistKeywords = settings.whitelistKeywords || DEFAULT_SETTINGS.whitelistKeywords;
    const threshold = settings.largeAmountThreshold ?? DEFAULT_SETTINGS.largeAmountThreshold;

    detectTransfers(transactions);

    for (const t of transactions) {
      // --- Category ---
      if (t.manualCategory) {
        t.category = t.manualCategory;
      } else if (t.category !== 'transfers') {
        if (t.amount > 0) {
          t.category = t.accountId === 'savings' ? 'savings' : 'income';
        } else {
          t.category = 'spending';
        }
      }

      // --- Business tax tag (independent of category) ---
      if (t.manualBusinessTag !== null && t.manualBusinessTag !== undefined) {
        t.businessTag = t.manualBusinessTag;
        t.autoFlaggedLarge = false;
        continue;
      }

      const isWhitelisted = matchesKeywords(t.description, whitelistKeywords);
      const isBusinessKeyword = matchesKeywords(t.description, businessKeywords);
      t.autoFlaggedLarge = false;

      if (isWhitelisted) {
        t.businessTag = false;
      } else if (isBusinessKeyword) {
        t.businessTag = true;
      } else if (t.amount < 0 && Math.abs(t.amount) >= threshold) {
        t.businessTag = true;
        t.autoFlaggedLarge = true;
      } else {
        t.businessTag = false;
      }
    }
    return transactions;
  }

  return { categorize, detectTransfers, DEFAULT_SETTINGS };
})();
