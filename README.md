# Ledger — Income & Tax

A private, on-device PWA that reads CSV exports from your spending and savings
accounts, works out your real monthly income (excluding transfers between
your own accounts), flags likely business transactions, and estimates your
Australian income tax for the year.

**All data stays on your phone.** There's no backend and no analytics —
everything is stored in the browser's IndexedDB. Deleting the app or clearing
Safari's site data erases everything.

## File structure

```
bank-tax-analyser/
├── index.html          # App shell — all 5 screens live here, toggled by JS
├── manifest.json        # Makes it installable ("Add to Home Screen")
├── service-worker.js    # Caches the app shell so it works offline
├── css/
│   └── styles.css       # All styling
├── js/
│   ├── db.js             # IndexedDB wrapper (transactions/statements/settings)
│   ├── csvParser.js      # Turns raw bank CSV text into normalised rows
│   ├── categorizer.js    # Transfer detection + business/income keyword rules
│   ├── taxCalculator.js  # ATO brackets, Medicare levy, LITO
│   └── app.js            # UI wiring — the only file that touches the DOM
└── icons/                # App icons for the home screen
```

Nothing here needs a build step (no npm, no bundler). It's plain HTML/CSS/JS
plus one CDN library (PapaParse, for CSV parsing) loaded in `index.html`.

## Running it locally first (on your laptop)

You can't just double-click `index.html` — browsers block some of the APIs
this app needs (service workers, some fetch behaviour) when loaded via
`file://`. Serve it over local HTTP instead:

```bash
cd bank-tax-analyser
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser. Try uploading a test CSV
from each account and confirm the dashboard, transactions list, and tax
estimate all behave as expected.

## Getting it onto your iPhone

The simplest path with no App Store, no Apple Developer account, no Xcode:

1. **Host the files somewhere reachable over HTTPS.** iOS's "Add to Home
   Screen" installability and service workers require HTTPS (localhost is
   exempt, but your phone can't reach your laptop's localhost). Easiest free
   options:
   - **GitHub Pages** — push this folder to a GitHub repo, enable Pages in
     Settings → Pages, and you'll get a `https://yourname.github.io/repo/` URL.
   - **Netlify Drop** (app.netlify.com/drop) — drag the folder in, get an
     instant HTTPS URL, no account required for a quick test.
   - **Cloudflare Pages** — similar, free, slightly more setup.
2. On your iPhone, open that URL in **Safari** (must be Safari, not Chrome —
   only Safari can install PWAs on iOS).
3. Tap the **Share** icon → **Add to Home Screen** → **Add**.
4. The app now opens full-screen from your home screen like a native app,
   and keeps working offline once the service worker has cached it.

## Getting your bank CSVs

In your banking app or online banking portal, look for **Export
transactions** or **Download statement**, and choose **CSV** (not PDF or
OFX). Most Australian banks (CBA, ANZ, Westpac, NAB) export CSV with either
a header row and Debit/Credit or Amount columns, or — CBA's classic export —
no header row at all in Date, Description, Amount, Balance order. The parser
in `js/csvParser.js` auto-detects both shapes. If your bank's export doesn't
parse cleanly, open the CSV in a text editor, check the actual column order,
and adjust `HEADER_ALIASES` in that file to match.

## How the categorisation works

Rules run in this order, first match wins:

1. **Manual override** — anything you've changed by hand in the
   Transactions tab is never touched again by auto-categorisation, even
   after you edit your keyword lists or re-upload.
2. **Transfers**: any spending-account transaction is checked against every
   savings-account transaction for a same-amount, opposite-direction entry
   within 3 days. If found, both legs are marked `transfer` and excluded
   from income. This is a heuristic — check the Transactions tab after each
   upload and manually recategorise anything it gets wrong.
3. **Personal whitelist** (Settings tab): descriptions matching a whitelist
   keyword are always `personal`, regardless of amount. Use this for
   recurring large-ish personal spends that would otherwise get swept up by
   the large-amount flag below — e.g. add `7-ELEVEN` if you regularly fill
   up there for over $80.
4. **Business keywords** (Settings tab): descriptions matching a business
   keyword are flagged `business` regardless of amount. Add client names,
   invoice references, or your ABN.
5. **Large-amount flag**: any remaining debit at or above your threshold
   (default $80, editable in Settings) is auto-flagged `business` as
   something worth a manual look — big one-off spends are disproportionately
   likely to be work-related. These show a small "large" badge in the
   Transactions tab and get called out on the Dashboard so you don't have to
   hunt for them.
6. **Default**: any remaining credit is `income`; any remaining debit is
   `personal`.

### Custom categories

Settings → Categories lets you add your own tags (e.g. "Groceries", "Fuel")
on top of the five built-in ones. They show up in the Transactions category
dropdown and the filter bar. The five built-ins (income/business/transfer/
personal/uncategorized) can't be removed since the dashboard and tax
projection logic depend on them.

### Managing statements

Upload tab → each statement has a **Delete** button, which removes it and
every transaction that came from it. Handy if you uploaded the wrong file or
picked the wrong account — no need to wipe everything and start over.

## Extending it

- **More accounts**: currently hardcoded to `spending`/`savings`. To support
  more, generalise `accountId` handling in `app.js` and `categorizer.js`
  (the transfer matcher currently assumes exactly two account buckets).
- **PDF statements**: would need a PDF text-extraction step before the CSV
  parser — out of scope for the MVP but a natural next add if your bank only
  offers PDF exports.
- **Next financial year**: when FY2026-27 starts, add a `taxYear` selector in
  Settings that switches `TAX_YEAR` in `app.js` — the bracket data for that
  year is already stubbed in `taxCalculator.js`.
- **Sole trader specifics** (GST, quarterly BAS, superannuation): this
  currently estimates personal income tax only. If you're registered for
  GST or running as a sole trader with quarterly obligations, treat the tax
  estimate here as a starting point, not a lodgement-ready figure — a
  registered tax agent should confirm anything you're about to act on.

## A note on accuracy

The tax calculator is a general estimate for an Australian resident
individual using FY2025–26 ATO rates plus the Medicare levy and LITO. It
does not account for HECS/HELP repayments, the Medicare levy low-income
exemption thresholds, the private health insurance rebate/surcharge, or any
offsets beyond LITO. Treat it as a planning tool, not a lodgement figure.
