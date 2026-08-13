/**
 * app.js — wires up the UI. No framework, just direct DOM.
 */
(() => {
  const TAX_YEAR = 'FY2025-26';
  const BUILTIN_CATEGORIES = ['income', 'savings', 'transfers', 'spending', 'uncategorized'];

  let allTransactions = [];
  let allStatements = [];
  let rules = {
    businessKeywords: Categorizer.DEFAULT_SETTINGS.businessKeywords.slice(),
    whitelistKeywords: [],
    largeAmountThreshold: 80,
  };
  let categories = BUILTIN_CATEGORIES.slice();
  let currentMonthKey = monthKeyFromDate(new Date());

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function monthKeyFromDate(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  }

  function shiftMonthKey(monthKey, delta) {
    const [y, m] = monthKey.split('-').map(Number);
    return monthKeyFromDate(new Date(y, m - 1 + delta, 1));
  }

  function monthLabel(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  }

  function fmtMoney(n) {
    const sign = n < 0 ? '−' : '';
    return sign + '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function labelFor(cat) {
    return cat.charAt(0).toUpperCase() + cat.slice(1);
  }

  function normaliseMerchant(description) {
    return description
      .replace(/\bValue Date:.*$/i, '')
      .replace(/\bCard xx\d+.*$/i, '')
      .replace(/\b\d{3,}\b/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 40) || description.slice(0, 40);
  }

  // ---------- Navigation ----------
  function showView(name) {
    $$('.view').forEach(v => v.hidden = v.dataset.view !== name);
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.target === name));
    if (name === 'dashboard') renderDashboard();
    if (name === 'transactions') { populateCategorySelects(); renderTransactions(); }
    if (name === 'upload') renderStatementList();
    if (name === 'tax') renderTax();
    if (name === 'settings') renderSettings();
  }

  $$('.tab').forEach(tab => tab.addEventListener('click', () => showView(tab.dataset.target)));

  // ---------- Data load ----------
  async function loadAll() {
    allTransactions = await DB.getAll('transactions');
    allStatements = await DB.getAll('statements');
    rules.businessKeywords = await DB.getSetting('businessKeywords', rules.businessKeywords);
    rules.whitelistKeywords = await DB.getSetting('whitelistKeywords', rules.whitelistKeywords);
    rules.largeAmountThreshold = await DB.getSetting('largeAmountThreshold', rules.largeAmountThreshold);
    categories = await DB.getSetting('categories', categories);
    // Migrate transactions saved under the old scheme (category 'business'/'personal'/'transfer')
    let migrated = false;
    allTransactions.forEach(t => {
      if (t.manualBusinessTag === undefined) { t.manualBusinessTag = null; migrated = true; }
      if (t.category === 'transfer') { t.category = 'transfers'; if (t.manualCategory === 'transfer') t.manualCategory = 'transfers'; migrated = true; }
      if (t.category === 'personal') { t.category = 'spending'; if (t.manualCategory === 'personal') t.manualCategory = 'spending'; migrated = true; }
      if (t.category === 'business') { t.category = 'spending'; t.manualBusinessTag = true; if (t.manualCategory === 'business') t.manualCategory = 'spending'; migrated = true; }
    });
    if (categories.includes('business')) { categories = categories.map(c => c === 'business' ? 'spending' : c); migrated = true; }
    if (categories.includes('transfer')) { categories = categories.map(c => c === 'transfer' ? 'transfers' : c); migrated = true; }
    if (categories.includes('personal')) { categories = categories.filter(c => c !== 'personal'); migrated = true; }
    if (!categories.includes('savings')) { categories.splice(1, 0, 'savings'); migrated = true; }
    if (migrated) await DB.setSetting('categories', categories);
    await recategorizeAndPersist();
  }

  async function recategorizeAndPersist() {
    Categorizer.categorize(allTransactions, rules);
    if (allTransactions.length) await DB.putAll('transactions', allTransactions);
  }

  // ---------- Category selects ----------
  function populateCategorySelects() {
    const filterSel = $('#filterCategory');
    const current = filterSel.value;
    filterSel.innerHTML = '<option value="all">All categories</option>' +
      categories.map(c => `<option value="${c}">${labelFor(c)}</option>`).join('') +
      '<option value="business-tagged">Tax-flagged only</option>';
    filterSel.value = current || 'all';
  }

  // ---------- Dashboard ----------
  function monthTransactions(monthKey) {
    return allTransactions.filter(t => t.monthKey === monthKey);
  }

  function netForMonth(monthKey) {
    const txs = monthTransactions(monthKey);
    const income = txs.filter(t => t.category === 'income').reduce((s, t) => s + t.amount, 0);
    const spend = txs.filter(t => t.category === 'spending').reduce((s, t) => s + Math.abs(t.amount), 0);
    return { income, spend, net: income - spend };
  }

  function accountBalances() {
    const result = {};
    for (const accountId of ['spending', 'savings']) {
      const txs = allTransactions
        .filter(t => t.accountId === accountId && t.balance !== null && t.balance !== undefined)
        .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      const latest = txs[txs.length - 1];
      result[accountId] = latest ? { balance: latest.balance, asOf: latest.date } : null;
    }
    return result;
  }

  function findMissingMonths() {
    if (!allTransactions.length) return [];
    const allKeys = allTransactions.map(t => t.monthKey).sort();
    const minKey = allKeys[0];
    const maxKey = allKeys[allKeys.length - 1];
    const missing = [];
    for (const accountId of ['spending', 'savings']) {
      const present = new Set(allTransactions.filter(t => t.accountId === accountId).map(t => t.monthKey));
      let cursor = minKey;
      while (cursor <= maxKey) {
        if (!present.has(cursor) && cursor !== maxKey) {
          missing.push({ accountId, monthKey: cursor });
        }
        cursor = shiftMonthKey(cursor, 1);
      }
    }
    return missing;
  }

  function renderDashboard() {
    $('#currentMonthLabel').textContent = monthLabel(currentMonthKey);
    const txs = monthTransactions(currentMonthKey);
    $('#noDataCard').hidden = txs.length > 0;

    const income = txs.filter(t => t.category === 'income').reduce((s, t) => s + t.amount, 0);
    const savings = txs.filter(t => t.category === 'savings').reduce((s, t) => s + t.amount, 0);
    const spending = txs.filter(t => t.category === 'spending').reduce((s, t) => s + Math.abs(t.amount), 0);
    const transfers = txs.filter(t => t.category === 'transfers' && t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const uncat = txs.filter(t => t.category === 'uncategorized').reduce((s, t) => s + Math.abs(t.amount), 0);
    const taxFlagged = txs.filter(t => t.businessTag).reduce((s, t) => s + Math.abs(t.amount), 0);

    $('#sumIncome').textContent = fmtMoney(income);
    $('#sumBusiness').textContent = fmtMoney(taxFlagged);
    $('#sumTransfers').textContent = fmtMoney(transfers);
    $('#sumUncat').textContent = fmtMoney(uncat);

    // Account balances
    const balances = accountBalances();
    $('#balanceSpending').textContent = balances.spending ? fmtMoney(balances.spending.balance) : '—';
    $('#balanceSpendingAsOf').textContent = balances.spending ? `as of ${balances.spending.asOf}` : 'no data yet';
    $('#balanceSavings').textContent = balances.savings ? fmtMoney(balances.savings.balance) : '—';
    $('#balanceSavingsAsOf').textContent = balances.savings ? `as of ${balances.savings.asOf}` : 'no data yet';

    // Missing months warning
    const missing = findMissingMonths();
    $('#missingMonthsCard').hidden = missing.length === 0;
    if (missing.length) {
      const byAccount = { spending: [], savings: [] };
      missing.forEach(m => byAccount[m.accountId].push(monthLabel(m.monthKey)));
      const parts = [];
      if (byAccount.spending.length) parts.push(`<strong>Spending:</strong> ${byAccount.spending.join(', ')}`);
      if (byAccount.savings.length) parts.push(`<strong>Savings:</strong> ${byAccount.savings.join(', ')}`);
      $('#missingMonthsNote').innerHTML = `Looks like statement data is missing for some months in your date range:<br>${parts.join('<br>')}`;
    }

    // Auto-flagged large transactions worth a manual look
    const flaggedLarge = txs.filter(t => t.autoFlaggedLarge);
    $('#flaggedCard').hidden = flaggedLarge.length === 0;
    if (flaggedLarge.length) {
      $('#flaggedNote').innerHTML = `<strong>${flaggedLarge.length} transaction${flaggedLarge.length > 1 ? 's' : ''}</strong> auto-flagged for tax (over $${rules.largeAmountThreshold}). Review them in the Transactions tab.`;
    }

    // Net cash flow + comparison to previous month
    const net = netForMonth(currentMonthKey);
    $('#netCashFlow').textContent = fmtMoney(net.net);
    $('#netCashFlow').className = 'figure mono ' + (net.net >= 0 ? '' : 'muted');
    const prevKey = shiftMonthKey(currentMonthKey, -1);
    const prev = netForMonth(prevKey);
    if (prev.income > 0) {
      const delta = ((net.income - prev.income) / prev.income) * 100;
      const dir = delta >= 0 ? 'up' : 'down';
      $('#vsLastMonth').textContent = `Income ${dir} ${Math.abs(delta).toFixed(0)}% vs ${monthLabel(prevKey)} (${fmtMoney(prev.income)})`;
    } else {
      $('#vsLastMonth').textContent = '';
    }

    // Category bars
    const maxCat = Math.max(income, savings, spending, taxFlagged, 1);
    const bars = [
      { label: 'Income', value: income, cls: '' },
      { label: 'Savings', value: savings, cls: '' },
      { label: 'Spending', value: spending, cls: 'business' },
      { label: 'Tax-flagged', value: taxFlagged, cls: 'business' },
    ];
    $('#categoryBars').innerHTML = bars.map(b => `
      <div class="bar-row">
        <div class="bar-label"><span>${b.label}</span><span class="amount">${fmtMoney(b.value)}</span></div>
        <div class="bar-track"><div class="bar-fill ${b.cls}" style="width:${Math.min(100, (b.value / maxCat) * 100)}%"></div></div>
      </div>
    `).join('') || '<p class="empty-state">Nothing this month yet.</p>';

    // Top merchants (by spend, grouped on a normalised description)
    const spendTxs = txs.filter(t => t.amount < 0 && t.category !== 'transfers');
    const merchantTotals = {};
    for (const t of spendTxs) {
      const key = normaliseMerchant(t.description);
      merchantTotals[key] = (merchantTotals[key] || 0) + Math.abs(t.amount);
    }
    const topMerchants = Object.entries(merchantTotals).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxMerchant = topMerchants.length ? topMerchants[0][1] : 1;
    $('#topMerchants').innerHTML = topMerchants.length
      ? topMerchants.map(([name, total]) => `
          <div class="bar-row">
            <div class="bar-label"><span>${escapeHtml(name)}</span><span class="amount">${fmtMoney(total)}</span></div>
            <div class="bar-track"><div class="bar-fill business" style="width:${(total / maxMerchant) * 100}%"></div></div>
          </div>
        `).join('')
      : '<p class="empty-state">No spending recorded yet.</p>';

    // Stat grid
    const spendCount = spendTxs.length;
    const avgSpend = spendCount ? spendTxs.reduce((s, t) => s + Math.abs(t.amount), 0) / spendCount : 0;
    const largest = spendTxs.reduce((max, t) => Math.abs(t.amount) > Math.abs(max?.amount || 0) ? t : max, null);
    $('#statGrid').innerHTML = `
      <div class="stat"><div class="stat-label">Transactions</div><div class="stat-value">${txs.length}</div></div>
      <div class="stat"><div class="stat-label">Avg. spend</div><div class="stat-value">${fmtMoney(avgSpend)}</div></div>
      <div class="stat"><div class="stat-label">Largest spend</div><div class="stat-value">${largest ? fmtMoney(Math.abs(largest.amount)) : '—'}</div></div>
      <div class="stat"><div class="stat-label">Tax-flagged</div><div class="stat-value">${flaggedLarge.length}</div></div>
    `;
  }

  $('#prevMonth').addEventListener('click', () => { currentMonthKey = shiftMonthKey(currentMonthKey, -1); renderDashboard(); });
  $('#nextMonth').addEventListener('click', () => { currentMonthKey = shiftMonthKey(currentMonthKey, 1); renderDashboard(); });

  // ---------- Upload ----------
  const dropzone = $('#dropzone');
  const fileInput = $('#fileInput');
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    await handleFile(file);
    fileInput.value = '';
  });

  async function handleFile(file) {
    const accountId = $('#accountSelect').value;
    const hintEl = $('#uploadHint');
    hintEl.textContent = 'Reading file…';
    try {
      const text = await file.text();
      const rows = CsvParser.parseCsvText(text);
      if (!rows.length) {
        hintEl.textContent = `Couldn't find any transaction rows in "${file.name}". Check it's an unedited export from your bank.`;
        return;
      }
      const statementId = 'st_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const statement = {
        id: statementId, accountId, filename: file.name,
        uploadedAt: new Date().toISOString(), rowCount: rows.length,
      };
      const newTxs = rows.map((r, i) => ({
        id: `${statementId}-${i}`, statementId, accountId,
        date: r.date, monthKey: monthKeyFromDate(r.date),
        description: r.description, amount: r.amount, balance: r.balance,
        category: null, manualCategory: null,
        businessTag: false, manualBusinessTag: null,
      }));

      await DB.put('statements', statement);
      allStatements.push(statement);
      allTransactions.push(...newTxs);
      await recategorizeAndPersist();

      hintEl.textContent = `Added ${rows.length} transactions from "${file.name}".`;
      renderStatementList();
      currentMonthKey = newTxs[newTxs.length - 1].monthKey;
    } catch (err) {
      console.error(err);
      hintEl.textContent = 'Something went wrong reading that file. Make sure it\'s a CSV export, not a PDF.';
    }
  }

  function renderStatementList() {
    const container = $('#statementList');
    if (!allStatements.length) {
      container.innerHTML = '<p class="empty-state">No statements uploaded yet.</p>';
      return;
    }
    container.innerHTML = allStatements
      .slice().sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
      .map(s => `
        <div class="statement-row">
          <span class="statement-info"><span class="acc-tag">${s.accountId}</span><span>${escapeHtml(s.filename)}</span></span>
          <span style="margin: 0 8px; color: var(--muted); font-size: 12px; flex-shrink:0;">${s.rowCount} rows</span>
          <button class="statement-delete" data-id="${s.id}">Delete</button>
        </div>
      `).join('');

    $$('.statement-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const statement = allStatements.find(s => s.id === btn.dataset.id);
        if (!confirm(`Remove "${statement.filename}" and its ${statement.rowCount} transactions?`)) return;
        await DB.deleteStatement(statement.id);
        allStatements = allStatements.filter(s => s.id !== statement.id);
        allTransactions = allTransactions.filter(t => t.statementId !== statement.id);
        renderStatementList();
      });
    });
  }

  // ---------- Transactions ----------
  function renderTransactions() {
    const accFilter = $('#filterAccount').value;
    const catFilter = $('#filterCategory').value;
    let txs = allTransactions.slice().sort((a, b) => b.date.localeCompare(a.date));
    if (accFilter !== 'all') txs = txs.filter(t => t.accountId === accFilter);
    if (catFilter === 'business-tagged') txs = txs.filter(t => t.businessTag);
    else if (catFilter !== 'all') txs = txs.filter(t => t.category === catFilter);

    const list = $('#txList');
    if (!txs.length) {
      list.innerHTML = '<p class="empty-state">No transactions match this filter.</p>';
      return;
    }
    list.innerHTML = txs.map(t => `
      <div class="tx-row" data-id="${t.id}">
        <div class="tx-main">
          <div class="tx-desc">${escapeHtml(t.description)}${t.autoFlaggedLarge ? '<span class="large-flag-badge">large</span>' : ''}</div>
          <div class="tx-meta">${t.date} · ${t.accountId}</div>
        </div>
        <div style="text-align:right">
          <div class="tx-amount ${t.amount > 0 ? 'credit' : 'debit'}">${fmtMoney(t.amount)}</div>
          <div class="tx-controls">
            <select class="tx-cat-select" data-id="${t.id}">
              ${categories.map(c => `<option value="${c}" ${c === t.category ? 'selected' : ''}>${labelFor(c)}</option>`).join('')}
            </select>
            <button class="tax-tag-btn ${t.businessTag ? 'active' : ''}" data-id="${t.id}" title="Toggle tax flag">🏷</button>
          </div>
        </div>
      </div>
    `).join('');

    $$('.tx-cat-select').forEach(sel => {
      sel.addEventListener('change', async (e) => {
        const t = allTransactions.find(t => t.id === e.target.dataset.id);
        const newCat = e.target.value;
        t.manualCategory = newCat;
        t.category = newCat;
        await DB.put('transactions', t);
        await offerBulkApply(t, 'category', newCat);
        renderDashboard();
        renderTransactions();
      });
    });

    $$('.tax-tag-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const t = allTransactions.find(t => t.id === btn.dataset.id);
        const newVal = !t.businessTag;
        t.manualBusinessTag = newVal;
        t.businessTag = newVal;
        t.autoFlaggedLarge = false;
        await DB.put('transactions', t);
        await offerBulkApply(t, 'businessTag', newVal);
        renderDashboard();
        renderTransactions();
      });
    });
  }

  /** After a manual edit, look for similarly-named transactions and offer to apply the same change to them. */
  async function offerBulkApply(sourceTx, field, value) {
    const key = normaliseMerchant(sourceTx.description);
    const similar = allTransactions.filter(t =>
      t.id !== sourceTx.id &&
      normaliseMerchant(t.description) === key &&
      (field === 'category' ? !t.manualCategory : (t.manualBusinessTag === null || t.manualBusinessTag === undefined)) &&
      (field === 'category' ? t.category !== value : t.businessTag !== value)
    );
    if (!similar.length) return;

    const label = field === 'category' ? `category "${labelFor(value)}"` : (value ? 'the tax flag' : 'removing the tax flag');
    const ok = confirm(`Apply ${label} to ${similar.length} other transaction${similar.length > 1 ? 's' : ''} from "${key}" too?`);
    if (!ok) return;

    for (const t of similar) {
      if (field === 'category') { t.manualCategory = value; t.category = value; }
      else { t.manualBusinessTag = value; t.businessTag = value; t.autoFlaggedLarge = false; }
    }
    await DB.putAll('transactions', similar);
  }

  $('#filterAccount').addEventListener('change', renderTransactions);
  $('#filterCategory').addEventListener('change', renderTransactions);

  // ---------- Tax ----------
  function renderTax() {
    const input = $('#taxableIncomeInput');
    const income = parseFloat(input.value) || 0;
    const result = TaxCalculator.estimate(income, TAX_YEAR);

    $('#taxIncomeTax').textContent = fmtMoney(result.incomeTaxAfterOffset);
    $('#taxMedicare').textContent = fmtMoney(result.medicareLevy);
    $('#taxLito').textContent = '−' + fmtMoney(result.lito);
    $('#taxTotal').textContent = fmtMoney(result.total);
    $('#taxEffective').textContent = (result.effectiveRate * 100).toFixed(1) + '%';

    $('#bracketBreakdown').innerHTML = result.perBracket
      .filter(b => b.taxableInBand > 0)
      .map(b => `
        <div class="bracket-row">
          <span class="bracket-range">${(b.rate * 100).toFixed(0)}% · $${b.min.toLocaleString()}–${b.max ? '$' + b.max.toLocaleString() : '+'}</span>
          <span>${fmtMoney(b.taxInBand)}</span>
        </div>
      `).join('');

    const taxDeductible = allTransactions.filter(t => t.businessTag && t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    $('#taxDeductibleNote').textContent = taxDeductible > 0
      ? `You've tax-flagged ${fmtMoney(taxDeductible)} in expenses across all statements — worth reviewing with your tax agent as possible deductions.`
      : '';
  }

  $('#taxableIncomeInput').addEventListener('input', renderTax);

  $('#projectIncomeBtn').addEventListener('click', () => {
    const monthsSeen = new Set(allTransactions.map(t => t.monthKey));
    const taxableTxs = allTransactions.filter(t => t.category === 'income' || t.category === 'savings');
    const totalSoFar = taxableTxs.reduce((s, t) => s + Math.max(0, t.amount), 0);
    const monthCount = Math.max(1, monthsSeen.size);
    const projected = (totalSoFar / monthCount) * 12;
    $('#taxableIncomeInput').value = Math.round(projected);
    renderTax();
  });

  // ---------- Settings ----------
  function renderSettings() {
    $('#largeAmountThreshold').value = rules.largeAmountThreshold;
    $('#whitelistKeywords').value = rules.whitelistKeywords.join('\n');
    $('#businessKeywords').value = rules.businessKeywords.join('\n');
    renderCategoryManager();
  }

  function renderCategoryManager() {
    $('#categoryManagerList').innerHTML = categories.map(c => {
      const isBuiltin = BUILTIN_CATEGORIES.includes(c);
      return `
        <div class="category-row">
          <span>${labelFor(c)}${isBuiltin ? ' <span style="color:var(--muted)">(built-in)</span>' : ''}</span>
          ${isBuiltin ? '' : `<button class="cat-remove" data-cat="${c}">Remove</button>`}
        </div>
      `;
    }).join('');

    $$('.cat-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        categories = categories.filter(c => c !== btn.dataset.cat);
        await DB.setSetting('categories', categories);
        renderCategoryManager();
      });
    });
  }

  $('#addCategoryBtn').addEventListener('click', async () => {
    const input = $('#newCategoryInput');
    const raw = input.value.trim().toLowerCase().replace(/\s+/g, '-');
    if (!raw || categories.includes(raw)) { input.value = ''; return; }
    categories.push(raw);
    await DB.setSetting('categories', categories);
    input.value = '';
    renderCategoryManager();
  });

  $('#saveRulesBtn').addEventListener('click', async () => {
    rules.largeAmountThreshold = parseFloat($('#largeAmountThreshold').value) || 0;
    rules.whitelistKeywords = $('#whitelistKeywords').value.split('\n').map(s => s.trim()).filter(Boolean);
    rules.businessKeywords = $('#businessKeywords').value.split('\n').map(s => s.trim()).filter(Boolean);
    await DB.setSetting('largeAmountThreshold', rules.largeAmountThreshold);
    await DB.setSetting('whitelistKeywords', rules.whitelistKeywords);
    await DB.setSetting('businessKeywords', rules.businessKeywords);
    // Clear auto-decided category/tag (keep manual overrides) and re-run with new rules.
    allTransactions.forEach(t => {
      if (!t.manualCategory) t.category = null;
      if (t.manualBusinessTag === null || t.manualBusinessTag === undefined) t.businessTag = false;
    });
    await recategorizeAndPersist();
    renderDashboard();
  });

  $('#exportBtn').addEventListener('click', async () => {
    const data = { transactions: allTransactions, statements: allStatements, rules, categories };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ledger-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  });

  $('#resetBtn').addEventListener('click', async () => {
    if (!confirm('This erases every statement and transaction stored on this device. Continue?')) return;
    await DB.clearAll();
    location.reload();
  });

  // ---------- Init ----------
  async function init() {
    $('#taxYearLabel').textContent = TAX_YEAR.replace('FY', 'FY ');
    await loadAll();
    populateCategorySelects();
    if (allTransactions.length) {
      currentMonthKey = allTransactions.map(t => t.monthKey).sort().pop();
    }
    showView('dashboard');

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    }
  }

  init();
})();
