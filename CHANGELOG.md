# Changelog — v3

## Category & tax-tag rework

Categories and the tax flag are now independent of each other, per your
feedback:

- **`business` is no longer a category.** It's now a standalone tax tag
  (`businessTag: true/false`) that can sit on top of *any* category —
  toggle it with the 🏷 button next to each transaction in the Transactions
  tab. Filter the list to "Tax-flagged only" to see everything relevant at
  tax time, regardless of what category it's under.
- **`personal` renamed to `spending`** — the default category for any
  debit that isn't part of a matched transfer.
- **`transfer` renamed to `transfers`** (plural).
- **New `savings` category** — automatically applied to money landing in
  your savings account that *isn't* matched to an internal transfer (e.g.
  interest, a direct deposit, a manual top-up). A matched spending→savings
  transfer is still `transfers`, not `savings` — `savings` is specifically
  for one-directional money that shows up there without a corresponding
  debit elsewhere.

**Existing data migrates automatically** the first time you open v3: old
`business` transactions become `spending` + tax-flagged, `personal` becomes
`spending`, `transfer` becomes `transfers`. Nothing needs re-uploading.

## Added

- **Auto-categorise suggestions**: change a transaction's category or toggle
  its tax tag, and if other unedited transactions share a similar merchant
  name, you'll be asked whether to apply the same change to all of them.
- **Missing-month detection**: the dashboard now flags any month within your
  data's date range where a given account has no transactions at all — a
  sign a statement export is missing.
- **Account balances on the dashboard**: shows the latest known balance for
  both spending and savings, taken from the most recent transaction's
  balance column, with a "as of" date.
- **Tax tab now surfaces total tax-flagged spend** across all statements as
  a standalone note, separate from the bracket estimate.

## Verified against your real CommBank CSV

- 200 rows parse correctly (income: 37, spending: 163)
- 12 transactions correctly auto-flagged for tax review
- Your 7-Eleven transactions stay `spending` with the tax tag off, once
  `7-ELEVEN` is on the whitelist — confirmed even though they're over the
  $80 threshold
- Latest balance picked up correctly as the most recent dated row's balance

## Files changed since v2

- `js/categorizer.js` — category/tax-tag split, savings category logic
- `js/app.js` — bulk-apply suggestions, balances, missing-month detection,
  automatic v2→v3 data migration
- `index.html` — balances card, missing-months warning card, tax tag button,
  tax-deductible summary in the Tax tab
- `css/styles.css` — styles for the above
