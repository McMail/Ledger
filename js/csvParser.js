/**
 * csvParser.js — turns a raw bank CSV into normalised transaction rows:
 * { date: 'YYYY-MM-DD', description, amount (signed, credit +, debit -), balance|null }
 *
 * Handles two common shapes:
 *  1) Header row present, with named columns (Date, Description, Debit/Withdrawal,
 *     Credit/Deposit, Balance) OR a single signed "Amount" column — Westpac/ANZ/NAB style.
 *  2) No header row at all — Date, Description, Amount, Balance — classic CBA export.
 * Column names are matched loosely so small variations don't break it.
 */
const CsvParser = (() => {

  const HEADER_ALIASES = {
    date:        ['date', 'transaction date', 'posted date', 'processed date'],
    description: ['description', 'narrative', 'details', 'transaction details', 'reference', 'merchant'],
    debit:       ['debit', 'withdrawal', 'debit amount', 'withdrawal amount', 'money out'],
    credit:      ['credit', 'deposit', 'credit amount', 'deposit amount', 'money in'],
    amount:      ['amount', 'transaction amount'],
    balance:     ['balance', 'running balance', 'account balance'],
  };

  function normaliseHeader(h) {
    return (h || '').toString().trim().toLowerCase();
  }

  function matchColumn(headers, aliasKey) {
    const aliases = HEADER_ALIASES[aliasKey];
    return headers.findIndex(h => aliases.includes(normaliseHeader(h)));
  }

  function looksLikeHeaderRow(row) {
    // A header row shouldn't parse as a date or a number in its first cell.
    const first = (row[0] || '').toString().trim();
    if (!first) return false;
    return isNaN(Date.parse(first)) && isNaN(parseFloat(first.replace(/[^0-9.\-]/g, '')));
  }

  function parseAmount(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    const cleaned = raw.toString().replace(/[^0-9.\-]/g, '');
    if (cleaned === '' || cleaned === '-') return null;
    return parseFloat(cleaned);
  }

  function parseDate(raw) {
    if (!raw) return null;
    const s = raw.toString().trim();
    // DD/MM/YYYY (most AU bank exports)
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = '20' + y;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    // YYYY-MM-DD already
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const parsed = new Date(s);
    if (!isNaN(parsed)) return parsed.toISOString().slice(0, 10);
    return null;
  }

  function parseCsvText(text) {
    const result = Papa.parse(text.trim(), { skipEmptyLines: true });
    const rows = result.data;
    if (!rows.length) return [];

    const first = rows[0];
    const hasHeader = looksLikeHeaderRow(first);

    if (hasHeader) {
      return parseWithHeader(rows);
    }
    return parseHeaderless(rows);
  }

  function parseWithHeader(rows) {
    const headers = rows[0];
    const dateIdx = matchColumn(headers, 'date');
    const descIdx = matchColumn(headers, 'description');
    const debitIdx = matchColumn(headers, 'debit');
    const creditIdx = matchColumn(headers, 'credit');
    const amountIdx = matchColumn(headers, 'amount');
    const balanceIdx = matchColumn(headers, 'balance');

    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 2) continue;
      const date = parseDate(row[dateIdx]);
      const description = (row[descIdx] || '').toString().trim();
      if (!date || !description) continue;

      let amount = null;
      if (amountIdx !== -1) {
        amount = parseAmount(row[amountIdx]);
      } else {
        const debit = parseAmount(row[debitIdx]);
        const credit = parseAmount(row[creditIdx]);
        amount = (credit || 0) - (debit ? Math.abs(debit) : 0);
      }
      if (amount === null) continue;

      out.push({
        date,
        description,
        amount,
        balance: balanceIdx !== -1 ? parseAmount(row[balanceIdx]) : null,
      });
    }
    return out;
  }

  function isCleanNumber(raw) {
    if (raw === undefined || raw === null) return false;
    return /^[+\-]?\d+(\.\d+)?$/.test(raw.toString().trim());
  }

  /**
   * Headerless exports (e.g. CommBank's CSV) don't name their columns, and
   * different exports order them differently — some are
   * Date, Description, Amount, Balance; CommBank's is
   * Date, Amount, Description, Balance. Column 0 is reliably the date, but
   * rather than hardcode an order, work out which of the remaining columns
   * is the description (not a clean number) and, of the two numeric
   * columns, which is the amount vs the running balance — using the fact
   * that balance[row] minus amount[row] must equal the balance of the
   * adjacent row in the statement, whichever direction it's sorted in.
   */
  function parseHeaderless(rows) {
    const dataRows = rows.filter(r => r && r.length >= 3 && parseDate(r[0]) !== null);
    if (!dataRows.length) return [];

    const numColCount = dataRows[0].length;
    const candidateCols = [];
    for (let c = 1; c < numColCount; c++) candidateCols.push(c);

    // Description column: the one that is NOT a clean number in most rows.
    const textScore = candidateCols.map(c => {
      const sample = dataRows.slice(0, 30);
      const nonNumeric = sample.filter(r => !isCleanNumber(r[c])).length;
      return { col: c, nonNumeric };
    });
    textScore.sort((a, b) => b.nonNumeric - a.nonNumeric);
    const descCol = textScore[0].col;
    const numericCols = candidateCols.filter(c => c !== descCol);

    let amountCol = numericCols[0];
    let balanceCol = numericCols[1];

    if (numericCols.length === 2) {
      const [colA, colB] = numericCols;
      const valsA = dataRows.map(r => parseAmount(r[colA]));
      const valsB = dataRows.map(r => parseAmount(r[colB]));

      const score = (amounts, balances) => {
        let matches = 0, total = 0;
        for (let j = 0; j < amounts.length - 1; j++) {
          if (amounts[j] === null || balances[j] === null || balances[j + 1] === null) continue;
          total++;
          const descending = Math.abs((balances[j] - amounts[j]) - balances[j + 1]) < 0.02;
          const ascending = Math.abs((balances[j + 1] - amounts[j + 1]) - balances[j]) < 0.02;
          if (descending || ascending) matches++;
        }
        return total ? matches / total : 0;
      };

      const scoreAasAmount = score(valsA, valsB);
      const scoreBasAmount = score(valsB, valsA);

      if (scoreBasAmount > scoreAasAmount) {
        amountCol = colB;
        balanceCol = colA;
      } else {
        amountCol = colA;
        balanceCol = colB;
      }
    }

    const out = [];
    for (const row of dataRows) {
      const date = parseDate(row[0]);
      const description = (row[descCol] || '').toString().trim();
      const amount = parseAmount(row[amountCol]);
      if (!date || !description || amount === null) continue;
      out.push({
        date,
        description,
        amount,
        balance: row[balanceCol] !== undefined ? parseAmount(row[balanceCol]) : null,
      });
    }
    return out;
  }

  return { parseCsvText };
})();
