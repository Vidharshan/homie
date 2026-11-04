import confetti from 'canvas-confetti';
import { store, CATEGORIES } from './state.js';
import { sounds } from './sound.js';
import { calculateBalances, generateUpiUrl, generateQrUrl, getCategoryById, formatCurrency, formatDateFriendly } from './expenses.js';
import { getMonthDays, getDayPresence, calculateMonthlyStats } from './calendar.js';

// Register PWA Service Worker for app installability & offline shell
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.log('SW registration skipped:', err);
    });
  });
}

class HomieApp {
  constructor() {
    this.appEl = document.getElementById('app');
    this.currentTab = 'expenses';
    this.calYear = new Date().getFullYear();
    this.calMonth = new Date().getMonth();
    this.selectedDateStr = new Date().toISOString().split('T')[0];
    this.expenseFilter = 'all';

    // Form states
    this.newExpense = {
      title: 'EB Bill',
      amount: '',
      category: 'ebill',
      payerId: null,
      splitMode: 'equal',
      date: new Date().toISOString().split('T')[0]
    };

    this.init();
  }

  init() {
    store.subscribe(() => {
      this.render();
    });
  }

  showToast(message) {
    const existing = document.querySelector('.toast-notice');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-notice show';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2400);
  }

  render() {
    const state = store.getState();
    const activeUserId = state.activeUserId;
    const todayStr = new Date().toISOString().split('T')[0];
    const todayPresence = getDayPresence(state, todayStr);
    const balanceData = calculateBalances(state);

    this.appEl.innerHTML = `
      <!-- Sticky App Header -->
      <header class="app-header">
        <div class="brand-area">
          <span class="brand-logo">🏡</span>
          <div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="brand-title">Homie</span>
              <span class="brand-badge">SQLite & PWA</span>
            </div>
          </div>
        </div>

        <div class="header-actions">
          <!-- Roommate Quick Switcher -->
          <div class="user-switch-pill" title="Switch active roommate">
            <button class="switch-btn ${activeUserId === 'r1' ? 'active' : ''}" data-action="switch-user" data-id="r1">
              <span class="avatar">${state.roommates.r1.avatar}</span>
              <span>${state.roommates.r1.name}</span>
            </button>
            <button class="switch-btn ${activeUserId === 'r2' ? 'active' : ''}" data-action="switch-user" data-id="r2">
              <span class="avatar">${state.roommates.r2.avatar}</span>
              <span>${state.roommates.r2.name}</span>
            </button>
          </div>

          <!-- Sound Mute/Unmute Toggle -->
          <button class="icon-btn" data-action="toggle-sound" title="${sounds.isMuted() ? 'Unmute cozy sounds' : 'Mute sounds'}">
            ${sounds.isMuted() ? '🔇' : '🔊'}
          </button>
        </div>
      </header>

      <!-- Segmented Navigation Tabs -->
      <div class="nav-tabs-wrapper">
        <nav class="segmented-nav" role="tablist">
          <button class="nav-tab-btn ${this.currentTab === 'expenses' ? 'active' : ''}" data-tab="expenses">
            <span>💸</span> Expenses
          </button>
          <button class="nav-tab-btn ${this.currentTab === 'calendar' ? 'active' : ''}" data-tab="calendar">
            <span>🗓️</span> Travel & Flat
          </button>
          <button class="nav-tab-btn ${this.currentTab === 'settings' ? 'active' : ''}" data-tab="settings">
            <span>⚙️</span> Roommates
          </button>
        </nav>
      </div>

      <!-- Main Content Views -->
      <main class="main-content">
        <!-- TAB 1: EXPENSES VIEW -->
        <section class="tab-pane ${this.currentTab === 'expenses' ? 'active' : ''}" id="pane-expenses">
          ${this.renderExpensesTab(state, balanceData)}
        </section>

        <!-- TAB 2: CALENDAR VIEW -->
        <section class="tab-pane ${this.currentTab === 'calendar' ? 'active' : ''}" id="pane-calendar">
          ${this.renderCalendarTab(state)}
        </section>

        <!-- TAB 3: SETTINGS VIEW -->
        <section class="tab-pane ${this.currentTab === 'settings' ? 'active' : ''}" id="pane-settings">
          ${this.renderSettingsTab(state)}
        </section>
      </main>

      <!-- Modal Container -->
      <div id="modal-container"></div>
    `;

    this.bindEvents();
  }

  /* --------------------------------------------------------------------------
     TAB 1: Expenses Renderer with Primary "Add Expense" Action on Home Page
     -------------------------------------------------------------------------- */
  renderExpensesTab(state, balanceData) {
    const isSettled = balanceData.settleAmount < 1;
    const activeUserId = state.activeUserId;

    // Filter expenses
    let filtered = [...state.expenses];
    if (this.expenseFilter === 'unsettled') {
      filtered = filtered.filter(e => !e.settled);
    } else if (this.expenseFilter === 'this_month') {
      const currentMonthPrefix = new Date().toISOString().slice(0, 7);
      filtered = filtered.filter(e => e.date.startsWith(currentMonthPrefix));
    }

    return `
      <!-- Hero Balance Card with Primary Add Expense Button -->
      <div class="balance-hero-card">
        <div class="balance-status-tag">
          <span>⚖️</span>
          <span>Flat Balance</span>
        </div>
        <h2 class="balance-hero-title">${balanceData.statusText}</h2>
        <p class="balance-hero-sub">${balanceData.subText}</p>

        <!-- Primary CTA & Secondary Action -->
        <div class="hero-actions">
          <button class="btn-primary-add" data-action="open-add-expense" id="btn-hero-add-expense">
            <span style="font-size: 18px; line-height: 1;">＋</span>
            <span>Add Expense</span>
          </button>

          ${!isSettled ? `
            <button class="btn-settle" data-action="open-settle-up">
              <span>🤝</span>
              <span>Settle Up (${formatCurrency(balanceData.settleAmount)})</span>
            </button>
          ` : `
            <div class="btn-settled-pill">
              <span>✨</span> All settled
            </div>
          `}
        </div>
      </div>

      <!-- Quick Metrics -->
      <div class="quick-stats-row">
        <div class="mini-stat-card">
          <span class="stat-label">Active Unsettled Spend</span>
          <span class="stat-val">${formatCurrency(balanceData.totalUnsettledSpend)}</span>
        </div>
        <div class="mini-stat-card">
          <span class="stat-label">Unsettled Items</span>
          <span class="stat-val">${balanceData.unsettledCount} ${balanceData.unsettledCount === 1 ? 'bill' : 'bills'}</span>
        </div>
      </div>

      <!-- Expense Feed Header -->
      <div class="section-header">
        <h3 class="section-title">
          <span>📜</span>
          <span>Shared Expenses</span>
        </h3>
        <div class="filter-pills">
          <button class="filter-pill ${this.expenseFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
          <button class="filter-pill ${this.expenseFilter === 'unsettled' ? 'active' : ''}" data-filter="unsettled">Unsettled</button>
          <button class="filter-pill ${this.expenseFilter === 'this_month' ? 'active' : ''}" data-filter="this_month">This Month</button>
        </div>
      </div>

      <!-- Expense Items Feed -->
      <div class="expense-feed">
        ${filtered.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">☕</div>
            <p class="empty-text">No expenses found here.</p>
            <p style="font-size: 12px; margin-top: 4px;">Tap "+ Add Expense" above to log a shared bill!</p>
          </div>
        ` : filtered.map(exp => {
          const cat = getCategoryById(exp.category);
          const payer = state.roommates[exp.payerId] || { name: 'Flatmate' };
          const isPayerMe = exp.payerId === activeUserId;
          const myShare = exp.shares?.[activeUserId] ?? (exp.amount / 2);

          let badgeClass = 'neutral';
          let badgeText = '';

          if (isPayerMe) {
            const lentAmount = exp.amount - myShare;
            if (lentAmount > 0) {
              badgeClass = 'lent';
              badgeText = `You lent ${formatCurrency(lentAmount)}`;
            } else {
              badgeClass = 'neutral';
              badgeText = `You paid`;
            }
          } else {
            badgeClass = 'borrowed';
            badgeText = `You owe ${formatCurrency(myShare)}`;
          }

          if (exp.settled) {
            badgeText = 'Settled ✓';
            badgeClass = 'neutral';
          }

          return `
            <div class="expense-card ${exp.settled ? 'settled' : ''}">
              <div class="exp-left">
                <div class="cat-icon-badge" style="background: ${cat.color}15;">
                  ${cat.icon}
                </div>
                <div class="exp-info">
                  <div class="exp-title">${exp.title}</div>
                  <div class="exp-meta">
                    <span>${formatDateFriendly(exp.date)}</span>
                    <span>•</span>
                    <span>Paid by ${payer.name}</span>
                  </div>
                </div>
              </div>

              <div class="exp-right">
                <div class="exp-total-amount">${formatCurrency(exp.amount)}</div>
                <span class="exp-share-badge ${badgeClass}">${badgeText}</span>
                <div class="exp-card-actions">
                  <button class="exp-action-btn delete" data-action="delete-expense" data-id="${exp.id}" title="Delete expense">
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  /* --------------------------------------------------------------------------
     TAB 2: Calendar Renderer
     -------------------------------------------------------------------------- */
  renderCalendarTab(state) {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthLabel = `${monthNames[this.calMonth]} ${this.calYear}`;
    const days = getMonthDays(this.calYear, this.calMonth);
    const stats = calculateMonthlyStats(state, this.calYear, this.calMonth);

    const todayStr = new Date().toISOString().split('T')[0];
    const todayPresence = getDayPresence(state, todayStr);
    const r1 = state.roommates.r1;
    const r2 = state.roommates.r2;

    return `
      <!-- Ambient Flat Vibe Banner (Exclusive to Travel & Flat tab) -->
      <section class="flat-vibe-banner">
        <div class="vibe-content">
          <span class="vibe-headline">${todayPresence.vibeText}</span>
          <span class="vibe-subtext">${todayPresence.vibeSub}</span>
        </div>
        <span class="vibe-badge">Today</span>
      </section>

      <div class="calendar-header-card">
        <button class="cal-nav-btn" data-action="cal-prev" title="Previous Month">‹</button>
        <div>
          <h2 class="cal-month-title">${monthLabel}</h2>
          <div style="text-align: center; margin-top: 2px;">
            <button class="filter-pill" data-action="cal-today" style="font-size: 11px; padding: 2px 10px;">
              Jump to Today
            </button>
          </div>
        </div>
        <button class="cal-nav-btn" data-action="cal-next" title="Next Month">›</button>
      </div>

      <div class="cal-legend-bar">
        <div class="legend-item">
          <span class="legend-dot blr"></span>
          <span>In Bangalore (Flat)</span>
        </div>
        <div class="legend-item">
          <span class="legend-dot home"></span>
          <span>Visiting Home</span>
        </div>
        <div class="legend-item">
          <span class="legend-dot wfh"></span>
          <span>Subtle Work Mode</span>
        </div>
      </div>

      <div class="calendar-card">
        <div class="cal-weekdays">
          <div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div><div>Sun</div>
        </div>

        <div class="cal-grid">
          ${days.map(d => {
            const presence = getDayPresence(state, d.dateStr);
            const isToday = d.dateStr === todayStr;
            const isSelected = d.dateStr === this.selectedDateStr;

            const r1IsBlr = presence.r1.status === 'bangalore';
            let r1WorkGlyph = '';
            if (r1IsBlr && presence.r1.workMode) {
              if (presence.r1.workMode === 'wfh') r1WorkGlyph = `<span class="subtle-work-glyph" title="WFH">💻</span>`;
              else if (presence.r1.workMode === 'wfo') r1WorkGlyph = `<span class="subtle-work-glyph" title="Office">🏢</span>`;
              else if (presence.r1.workMode === 'off') r1WorkGlyph = `<span class="subtle-work-glyph" title="Leave">🌴</span>`;
            }

            const r2IsBlr = presence.r2.status === 'bangalore';
            let r2WorkGlyph = '';
            if (r2IsBlr && presence.r2.workMode) {
              if (presence.r2.workMode === 'wfh') r2WorkGlyph = `<span class="subtle-work-glyph" title="WFH">💻</span>`;
              else if (presence.r2.workMode === 'wfo') r2WorkGlyph = `<span class="subtle-work-glyph" title="Office">🏢</span>`;
              else if (presence.r2.workMode === 'off') r2WorkGlyph = `<span class="subtle-work-glyph" title="Leave">🌴</span>`;
            }

            return `
              <div class="cal-day-cell ${!d.isCurrentMonth ? 'inactive-month' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}"
                   data-action="select-day" data-date="${d.dateStr}">
                <div class="day-header">
                  <span class="day-num">${d.dayNumber}</span>
                  ${isToday ? `<span class="today-pip"></span>` : ''}
                </div>

                <div class="day-presences">
                  <div class="roommate-mini-chip ${r1IsBlr ? 'blr' : 'home'}" title="${r1.name}: ${r1IsBlr ? 'Bangalore' : 'Home'}">
                    <span>${r1.avatar} ${r1IsBlr ? 'BLR' : 'HOME'}</span>
                    ${r1WorkGlyph}
                  </div>

                  <div class="roommate-mini-chip ${r2IsBlr ? 'blr' : 'home'}" title="${r2.name}: ${r2IsBlr ? 'Bangalore' : 'Home'}">
                    <span>${r2.avatar} ${r2IsBlr ? 'BLR' : 'HOME'}</span>
                    ${r2WorkGlyph}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="month-stats-card">
        <div class="month-stat-col">
          <span class="m-stat-val" style="color: var(--accent-blr);">${stats.sharedDays}d</span>
          <span class="m-stat-lbl">Shared Flat</span>
        </div>
        <div class="month-stat-col">
          <span class="m-stat-val" style="color: var(--accent-gold);">${stats.soloDays}d</span>
          <span class="m-stat-lbl">Solo Flat</span>
        </div>
        <div class="month-stat-col">
          <span class="m-stat-val" style="color: var(--accent-home);">${stats.bothAway}d</span>
          <span class="m-stat-lbl">Both Away</span>
        </div>
      </div>
    `;
  }

  /* --------------------------------------------------------------------------
     TAB 3: Settings & Roommate Profiles (Saved to SQLite DB)
     -------------------------------------------------------------------------- */
  renderSettingsTab(state) {
    const r1 = state.roommates.r1;
    const r2 = state.roommates.r2;

    return `
      <div class="settings-card">
        <div class="settings-card-title">
          <span>👥</span>
          <span>Roommate Profiles (Shared SQLite Database)</span>
        </div>
        <p style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 14px;">
          Saved directly to <code>homie.db</code> on the server so both of you see the exact same data.
        </p>

        <div class="roommate-edit-grid">
          <div class="profile-editor-box">
            <span style="font-size: 11px; font-weight: 700; color: var(--primary);">Roommate 1</span>
            <input type="text" class="text-input" style="padding: 8px 10px; font-size: 13px;" id="r1-name" value="${r1.name}" placeholder="Name" />
            <input type="text" class="text-input" style="padding: 8px 10px; font-size: 13px;" id="r1-avatar" value="${r1.avatar}" placeholder="Emoji Avatar" />
            <input type="text" class="text-input" style="padding: 8px 10px; font-size: 12px;" id="r1-upi" value="${r1.upi || ''}" placeholder="UPI ID" />
            <button class="filter-pill active" data-action="save-r1-profile" style="margin-top: 4px;">Save to SQLite</button>
          </div>

          <div class="profile-editor-box">
            <span style="font-size: 11px; font-weight: 700; color: var(--accent-blr);">Roommate 2</span>
            <input type="text" class="text-input" style="padding: 8px 10px; font-size: 13px;" id="r2-name" value="${r2.name}" placeholder="Name" />
            <input type="text" class="text-input" style="padding: 8px 10px; font-size: 13px;" id="r2-avatar" value="${r2.avatar}" placeholder="Emoji Avatar" />
            <input type="text" class="text-input" style="padding: 8px 10px; font-size: 12px;" id="r2-upi" value="${r2.upi || ''}" placeholder="UPI ID" />
            <button class="filter-pill active" data-action="save-r2-profile" style="margin-top: 4px;">Save to SQLite</button>
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">
          <span>📦</span>
          <span>Database & Backup</span>
        </div>
        <p style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 12px;">
          Database file: <code>homie/data/homie.db</code>. Back up or reset anytime.
        </p>

        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="filter-pill" data-action="export-data">📥 Export JSON</button>
          <button class="filter-pill" data-action="reset-data" style="color: #DC3545;">🔄 Reset Database</button>
        </div>
      </div>
    `;
  }

  /* --------------------------------------------------------------------------
     Modal: Ultra-Compact Single-Card Add Expense (Zero Scrolling, Only Requested Categories & 2 Splits)
     -------------------------------------------------------------------------- */
  openAddExpenseModal() {
    sounds.playClick();
    const state = store.getState();
    const activeUserId = state.activeUserId;
    const r1 = state.roommates.r1;
    const r2 = state.roommates.r2;

    this.newExpense = {
      title: 'EB Bill',
      amount: '',
      category: 'ebill',
      payerId: activeUserId,
      splitMode: 'equal',
      date: new Date().toISOString().split('T')[0]
    };

    const container = document.getElementById('modal-container');
    container.innerHTML = `
      <div class="modal-backdrop open" id="add-expense-modal">
        <div class="modal-sheet" style="padding: 18px 20px 22px; max-width: 480px; overflow: hidden;">
          <div class="sheet-header" style="margin-bottom: 12px;">
            <h3 class="sheet-title" style="font-size: 18px;">Add Expense 🥐</h3>
            <button class="sheet-close-btn" data-action="close-modal" style="width: 28px; height: 28px;">✕</button>
          </div>

          <form id="form-add-expense" class="compact-form">
            <!-- Row 1: Amount & Payer Side-by-Side -->
            <div class="compact-row">
              <div>
                <label class="compact-form-label">Amount</label>
                <div class="compact-amount-wrapper">
                  <span class="currency-symbol">₹</span>
                  <input type="number" step="any" min="1" id="exp-amount" class="compact-amount-input" placeholder="0" autofocus required />
                </div>
              </div>

              <div>
                <label class="compact-form-label">Paid By</label>
                <div class="user-switch-pill" style="padding: 2px;">
                  <button type="button" class="switch-btn ${this.newExpense.payerId === 'r1' ? 'active' : ''}" data-select-payer="r1" style="flex: 1; padding: 5px 8px; font-size: 12px;">
                    <span>${r1.avatar} ${r1.name}</span>
                  </button>
                  <button type="button" class="switch-btn ${this.newExpense.payerId === 'r2' ? 'active' : ''}" data-select-payer="r2" style="flex: 1; padding: 5px 8px; font-size: 12px;">
                    <span>${r2.avatar} ${r2.name}</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- Row 2: Categories (Only the 7 specific categories requested) -->
            <div>
              <label class="compact-form-label">Category</label>
              <div class="compact-category-pills">
                ${CATEGORIES.map(cat => `
                  <button type="button" class="cat-pill-chip ${this.newExpense.category === cat.id ? 'active' : ''}" data-cat-id="${cat.id}">
                    <span>${cat.icon}</span>
                    <span>${cat.name}</span>
                  </button>
                `).join('')}
              </div>
            </div>

            <!-- Row 3: Description -->
            <div>
              <label class="compact-form-label">Description / Note</label>
              <input type="text" id="exp-title" class="compact-text-input" value="EB Bill" placeholder="e.g. BESCOM electricity bill" required />
            </div>

            <!-- Row 4: Exactly Two Split Options: Split 50/50 vs Paid in Full -->
            <div>
              <label class="compact-form-label">Split Details</label>
              <div class="compact-split-grid">
                <button type="button" class="compact-split-btn ${this.newExpense.splitMode === 'equal' ? 'active' : ''}" data-split="equal">
                  <span class="compact-split-title">Split 50 / 50</span>
                  <span class="compact-split-sub">Half each</span>
                </button>
                <button type="button" class="compact-split-btn ${this.newExpense.splitMode === 'full_roommate' ? 'active' : ''}" data-split="full_roommate">
                  <span class="compact-split-title">Paid in Full</span>
                  <span class="compact-split-sub">100% for other</span>
                </button>
              </div>
            </div>

            <!-- Submit Button in Single Card -->
            <button type="submit" class="compact-submit-btn">Save Expense ✨</button>
          </form>
        </div>
      </div>
    `;

    const modal = document.getElementById('add-expense-modal');

    // Category chip selection
    modal.querySelectorAll('.cat-pill-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        sounds.playClick();
        const catId = btn.dataset.catId;
        this.newExpense.category = catId;
        modal.querySelectorAll('.cat-pill-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const titleInput = document.getElementById('exp-title');
        const selectedCat = getCategoryById(catId);
        titleInput.value = selectedCat.name;
      });
    });

    // Payer selection
    modal.querySelectorAll('[data-select-payer]').forEach(btn => {
      btn.addEventListener('click', () => {
        sounds.playClick();
        const pId = btn.dataset.selectPayer;
        this.newExpense.payerId = pId;
        modal.querySelectorAll('[data-select-payer]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Split selection (Only two options: equal or full_roommate)
    modal.querySelectorAll('[data-split]').forEach(btn => {
      btn.addEventListener('click', () => {
        sounds.playClick();
        const mode = btn.dataset.split;
        this.newExpense.splitMode = mode;
        modal.querySelectorAll('[data-split]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Submit handler
    document.getElementById('form-add-expense').addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = parseFloat(document.getElementById('exp-amount').value);
      const title = document.getElementById('exp-title').value.trim() || 'Shared expense';

      if (!amount || amount <= 0) return;

      let shares = {};
      if (this.newExpense.splitMode === 'equal') {
        shares = { r1: amount / 2, r2: amount / 2 };
      } else {
        const otherId = this.newExpense.payerId === 'r1' ? 'r2' : 'r1';
        shares = { [this.newExpense.payerId]: 0, [otherId]: amount };
      }

      await store.addExpense({
        title,
        amount,
        category: this.newExpense.category,
        payerId: this.newExpense.payerId,
        splitMode: this.newExpense.splitMode,
        shares,
        date: this.newExpense.date
      });

      sounds.playSuccess();
      confetti({
        particleCount: 35,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#E07A5F', '#81B29A', '#F2CC8F']
      });

      this.closeModal();
      this.showToast(`Saved ₹${amount} for ${title} to SQLite! 🥐`);
    });
  }

  /* --------------------------------------------------------------------------
     Modal: Settle Up with Roommate (UPI Deeplink & QR)
     -------------------------------------------------------------------------- */
  openSettleUpModal() {
    sounds.playClick();
    const state = store.getState();
    const balanceData = calculateBalances(state);

    if (balanceData.settleAmount < 1) return;

    const receiver = state.roommates[balanceData.creditorId];
    const sender = state.roommates[balanceData.debtorId];
    const upiUrl = generateUpiUrl(receiver.upi, receiver.name, balanceData.settleAmount);
    const qrUrl = generateQrUrl(upiUrl);

    const container = document.getElementById('modal-container');
    container.innerHTML = `
      <div class="modal-backdrop open" id="settle-modal">
        <div class="modal-sheet" style="padding: 20px 24px 28px;">
          <div class="sheet-handle"></div>
          <div class="sheet-header">
            <h3 class="sheet-title">Settle Up 🤝</h3>
            <button class="sheet-close-btn" data-action="close-modal">✕</button>
          </div>

          <div class="settle-hero-box">
            <div class="settle-big-amount">${formatCurrency(balanceData.settleAmount)}</div>
            <p class="settle-direction">
              <strong>${sender.name}</strong> pays <strong>${receiver.name}</strong>
            </p>
          </div>

          ${receiver.upi ? `
            <div class="qr-code-wrapper">
              <img src="${qrUrl}" alt="UPI QR Code" class="qr-image" />
            </div>
            <p style="text-align: center; font-size: 11.5px; color: var(--text-muted); margin-bottom: 16px;">
              Scan with GPay, PhonePe, Paytm, or BHIM
            </p>

            <div class="upi-actions-row">
              <a href="${upiUrl}" class="btn-upi-app" target="_blank" rel="noopener">
                <span>📱</span>
                <span>Open UPI Payment App (${receiver.upi})</span>
              </a>
            </div>
          ` : `
            <div style="background: var(--bg-subtle); padding: 12px; border-radius: var(--radius-sm); text-align: center; font-size: 12.5px; color: var(--text-muted); margin-bottom: 16px;">
              No UPI ID configured for ${receiver.name}. You can add one in the Roommates tab!
            </div>
          `}

          <div style="margin-top: 14px;">
            <button class="btn-mark-settled" data-action="confirm-settlement" style="width: 100%;">
              <span>✨</span>
              <span>Mark Balance as Fully Settled in SQLite</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.querySelector('[data-action="confirm-settlement"]')?.addEventListener('click', async () => {
      await store.settleBalance(balanceData.debtorId, balanceData.creditorId, balanceData.settleAmount);
      sounds.playSuccess();
      confetti({
        particleCount: 75,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#E07A5F', '#81B29A', '#F2CC8F', '#3D405B']
      });
      this.closeModal();
      this.showToast(`All settled up! Synced to SQLite ✨`);
    });
  }

  /* --------------------------------------------------------------------------
     Modal: Day Inspector & Subtle WFH/WFO Selector
     -------------------------------------------------------------------------- */
  openDayInspector(dateStr) {
    sounds.playClick();
    this.selectedDateStr = dateStr;
    const state = store.getState();
    const presence = getDayPresence(state, dateStr);

    const r1 = state.roommates.r1;
    const r2 = state.roommates.r2;

    const [y, m, d] = dateStr.split('-');
    const dateObj = new Date(y, parseInt(m) - 1, d);
    const friendlyDate = dateObj.toLocaleDateString('en-IN', {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    });

    const container = document.getElementById('modal-container');
    container.innerHTML = `
      <div class="modal-backdrop open" id="day-modal">
        <div class="modal-sheet">
          <div class="sheet-handle"></div>
          <div class="sheet-header">
            <div>
              <h3 class="sheet-title">${friendlyDate}</h3>
              <p style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
                ${presence.vibeText}
              </p>
            </div>
            <button class="sheet-close-btn" data-action="close-modal">✕</button>
          </div>

          <!-- Roommate 1 Presence Row -->
          <div class="inspector-roommate-row">
            <div class="inspector-user-head">
              <div class="inspector-user-info">
                <span>${r1.avatar}</span>
                <span>${r1.name}</span>
              </div>
              <div class="presence-toggle-pills">
                <button class="p-pill ${presence.r1.status === 'bangalore' ? 'active blr' : ''}"
                        data-toggle-status="r1" data-val="bangalore">
                  In Bangalore 🏠
                </button>
                <button class="p-pill ${presence.r1.status === 'home' ? 'active home' : ''}"
                        data-toggle-status="r1" data-val="home">
                  Visiting Home ✈️
                </button>
              </div>
            </div>

            ${presence.r1.status === 'bangalore' ? `
              <div class="subtle-wfh-container">
                <span class="subtle-wfh-label">Work mode (Optional):</span>
                <div class="subtle-chips">
                  <button class="subtle-chip ${presence.r1.workMode === 'wfh' ? 'active' : ''}" data-work-mode="r1" data-val="wfh">
                    💻 WFH
                  </button>
                  <button class="subtle-chip ${presence.r1.workMode === 'wfo' ? 'active' : ''}" data-work-mode="r1" data-val="wfo">
                    🏢 Office
                  </button>
                  <button class="subtle-chip ${presence.r1.workMode === 'off' ? 'active' : ''}" data-work-mode="r1" data-val="off">
                    🌴 Leave
                  </button>
                  ${presence.r1.workMode ? `
                    <button class="subtle-chip" data-work-mode="r1" data-val="" title="Clear" style="color: var(--text-muted);">
                      ✕
                    </button>
                  ` : ''}
                </div>
              </div>
            ` : ''}
          </div>

          <!-- Roommate 2 Presence Row -->
          <div class="inspector-roommate-row">
            <div class="inspector-user-head">
              <div class="inspector-user-info">
                <span>${r2.avatar}</span>
                <span>${r2.name}</span>
              </div>
              <div class="presence-toggle-pills">
                <button class="p-pill ${presence.r2.status === 'bangalore' ? 'active blr' : ''}"
                        data-toggle-status="r2" data-val="bangalore">
                  In Bangalore 🏠
                </button>
                <button class="p-pill ${presence.r2.status === 'home' ? 'active home' : ''}"
                        data-toggle-status="r2" data-val="home">
                  Visiting Home ✈️
                </button>
              </div>
            </div>

            ${presence.r2.status === 'bangalore' ? `
              <div class="subtle-wfh-container">
                <span class="subtle-wfh-label">Work mode (Optional):</span>
                <div class="subtle-chips">
                  <button class="subtle-chip ${presence.r2.workMode === 'wfh' ? 'active' : ''}" data-work-mode="r2" data-val="wfh">
                    💻 WFH
                  </button>
                  <button class="subtle-chip ${presence.r2.workMode === 'wfo' ? 'active' : ''}" data-work-mode="r2" data-val="wfo">
                    🏢 Office
                  </button>
                  <button class="subtle-chip ${presence.r2.workMode === 'off' ? 'active' : ''}" data-work-mode="r2" data-val="off">
                    🌴 Leave
                  </button>
                  ${presence.r2.workMode ? `
                    <button class="subtle-chip" data-work-mode="r2" data-val="" title="Clear" style="color: var(--text-muted);">
                      ✕
                    </button>
                  ` : ''}
                </div>
              </div>
            ` : ''}
          </div>

          <!-- Quick Multi-day Range Setter -->
          <div class="range-setter-card">
            <div class="range-setter-title">Going Home for a Trip? Mark Date Range 🧳</div>
            <div class="range-inputs">
              <input type="date" id="range-start-date" value="${dateStr}" />
              <span style="font-size: 12px; color: var(--text-muted);">to</span>
              <input type="date" id="range-end-date" value="${dateStr}" />
            </div>
            <button class="range-btn-apply" data-action="apply-trip-range">
              Mark ${state.roommates[state.activeUserId].name} Going Home for this range
            </button>
          </div>
        </div>
      </div>
    `;

    // Bind presence status buttons
    const modal = document.getElementById('day-modal');
    modal.querySelectorAll('[data-toggle-status]').forEach(btn => {
      btn.addEventListener('click', async () => {
        sounds.playClick();
        const rId = btn.dataset.toggleStatus;
        const status = btn.dataset.val;
        await store.setCalendarDay(dateStr, rId, status);
        this.openDayInspector(dateStr);
      });
    });

    // Bind subtle work mode buttons
    modal.querySelectorAll('[data-work-mode]').forEach(btn => {
      btn.addEventListener('click', async () => {
        sounds.playPop(1.1);
        const rId = btn.dataset.workMode;
        const mode = btn.dataset.val || null;
        await store.setCalendarDay(dateStr, rId, undefined, mode);
        this.openDayInspector(dateStr);
      });
    });

    // Apply trip range
    modal.querySelector('[data-action="apply-trip-range"]')?.addEventListener('click', async () => {
      const start = document.getElementById('range-start-date').value;
      const end = document.getElementById('range-end-date').value;
      if (!start || !end || start > end) {
        alert('Please choose a valid start and end date');
        return;
      }
      sounds.playSuccess();
      await store.setCalendarRange(start, end, state.activeUserId, 'home');
      this.closeModal();
      this.showToast(`Marked ${state.roommates[state.activeUserId].name} traveling home in SQLite! ✈️`);
    });
  }

  closeModal() {
    const backdrop = document.querySelector('.modal-backdrop');
    if (backdrop) {
      backdrop.classList.remove('open');
      setTimeout(() => {
        const container = document.getElementById('modal-container');
        if (container) container.innerHTML = '';
      }, 250);
    }
  }

  /* --------------------------------------------------------------------------
     Event Listeners
     -------------------------------------------------------------------------- */
  bindEvents() {
    // Navigation Tabs
    this.appEl.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sounds.playClick();
        this.currentTab = btn.dataset.tab;
        this.render();
      });
    });

    // User quick-switch pill in header
    this.appEl.querySelectorAll('[data-action="switch-user"]').forEach(btn => {
      btn.addEventListener('click', () => {
        sounds.playPop();
        const uId = btn.dataset.id;
        store.setActiveUser(uId);
        this.showToast(`Switched to ${store.getState().roommates[uId].name} ☕`);
      });
    });

    // Sound toggle
    this.appEl.querySelector('[data-action="toggle-sound"]')?.addEventListener('click', () => {
      const muted = sounds.toggleMute();
      if (!muted) sounds.playPop();
      this.render();
      this.showToast(muted ? 'Sound muted 🔇' : 'Cozy sound effects enabled 🔊');
    });

    // Primary Hero "Add Expense" Button on Home Page
    this.appEl.querySelector('#btn-hero-add-expense')?.addEventListener('click', () => {
      this.openAddExpenseModal();
    });

    // Settle Up Button
    this.appEl.querySelector('[data-action="open-settle-up"]')?.addEventListener('click', () => {
      this.openSettleUpModal();
    });

    // Expense Filters
    this.appEl.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        sounds.playClick();
        this.expenseFilter = btn.dataset.filter;
        this.render();
      });
    });

    // Delete Expense
    this.appEl.querySelectorAll('[data-action="delete-expense"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('Delete this expense?')) {
          sounds.playClick();
          await store.deleteExpense(btn.dataset.id);
          this.showToast('Expense removed from SQLite');
        }
      });
    });

    // Calendar Navigation
    this.appEl.querySelector('[data-action="cal-prev"]')?.addEventListener('click', () => {
      sounds.playClick();
      if (this.calMonth === 0) {
        this.calMonth = 11;
        this.calYear -= 1;
      } else {
        this.calMonth -= 1;
      }
      this.render();
    });

    this.appEl.querySelector('[data-action="cal-next"]')?.addEventListener('click', () => {
      sounds.playClick();
      if (this.calMonth === 11) {
        this.calMonth = 0;
        this.calYear += 1;
      } else {
        this.calMonth += 1;
      }
      this.render();
    });

    this.appEl.querySelector('[data-action="cal-today"]')?.addEventListener('click', () => {
      sounds.playClick();
      this.calYear = new Date().getFullYear();
      this.calMonth = new Date().getMonth();
      this.selectedDateStr = new Date().toISOString().split('T')[0];
      this.render();
    });

    // Calendar Day Select
    this.appEl.querySelectorAll('[data-action="select-day"]').forEach(cell => {
      cell.addEventListener('click', () => {
        const dateStr = cell.dataset.date;
        this.openDayInspector(dateStr);
      });
    });

    // Modal close clicks
    document.addEventListener('click', (e) => {
      if (e.target.matches('[data-action="close-modal"]') || e.target.classList.contains('modal-backdrop')) {
        this.closeModal();
      }
    });

    // Settings Profile Saves
    this.appEl.querySelector('[data-action="save-r1-profile"]')?.addEventListener('click', async () => {
      sounds.playSuccess();
      await store.updateRoommate('r1', {
        name: document.getElementById('r1-name').value.trim() || 'Roommate 1',
        avatar: document.getElementById('r1-avatar').value.trim() || '☕',
        upi: document.getElementById('r1-upi').value.trim()
      });
      this.showToast('Roommate 1 saved to SQLite! ✨');
    });

    this.appEl.querySelector('[data-action="save-r2-profile"]')?.addEventListener('click', async () => {
      sounds.playSuccess();
      await store.updateRoommate('r2', {
        name: document.getElementById('r2-name').value.trim() || 'Roommate 2',
        avatar: document.getElementById('r2-avatar').value.trim() || '🪴',
        upi: document.getElementById('r2-upi').value.trim()
      });
      this.showToast('Roommate 2 saved to SQLite! ✨');
    });

    // Export Data
    this.appEl.querySelector('[data-action="export-data"]')?.addEventListener('click', () => {
      sounds.playClick();
      const jsonStr = store.exportJSON();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `homie-sqlite-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('Backup downloaded! 📦');
    });

    // Reset Data
    this.appEl.querySelector('[data-action="reset-data"]')?.addEventListener('click', async () => {
      if (confirm('Reset SQLite database to fresh Bangalore defaults?')) {
        sounds.playClick();
        await store.resetToDefault();
        this.showToast('Database reset to defaults ✨');
      }
    });
  }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  new HomieApp();
});
