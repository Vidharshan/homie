// Homie Reactive State Store with SQLite Persistent Backend Integration & PWA Support

const API_BASE = '/api';

export const CATEGORIES = [
  { id: 'ebill', name: 'EB Bill', icon: '⚡', color: '#F4A261' },
  { id: 'water', name: 'Water Cans', icon: '💧', color: '#457B9D' },
  { id: 'supplies', name: 'Home Supplies', icon: '🧴', color: '#9A8C98' },
  { id: 'rent', name: 'Flat Rent', icon: '🏠', color: '#3D405B' },
  { id: 'maintenance', name: 'Maintenance', icon: '🛠️', color: '#E07A5F' },
  { id: 'food', name: 'Swiggy / DineIn', icon: '🍕', color: '#E76F51' },
  { id: 'others', name: 'Others', icon: '✨', color: '#6D6875' },
];

class StateStore {
  constructor() {
    this.subscribers = new Set();
    this.state = {
      roommates: {
        r1: { id: 'r1', name: 'Rohan', avatar: '☕', color: '#E07A5F', upi: 'rohan@okhdfcbank' },
        r2: { id: 'r2', name: 'Kabir', avatar: '🪴', color: '#81B29A', upi: 'kabir@icici' }
      },
      activeUserId: 'r1',
      expenses: [],
      settlements: [],
      calendar: {}
    };

    // Load from SQLite API
    this.fetchRemoteState();
  }

  async fetchRemoteState() {
    try {
      const res = await fetch(`${API_BASE}/state`);
      if (res.ok) {
        const data = await res.json();
        this.state = data;
        localStorage.setItem('homie_sqlite_cache', JSON.stringify(data));
        this.notify();
      }
    } catch {
      // Fallback to local cache if offline
      const cached = localStorage.getItem('homie_sqlite_cache');
      if (cached) {
        try {
          this.state = JSON.parse(cached);
          this.notify();
        } catch {}
      }
    }
  }

  notify() {
    for (const sub of this.subscribers) {
      try {
        sub(this.state);
      } catch (err) {
        console.error('Subscriber error:', err);
      }
    }
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    callback(this.state);
    return () => this.subscribers.delete(callback);
  }

  getState() {
    return this.state;
  }

  async setActiveUser(id) {
    if (this.state.roommates[id]) {
      this.state.activeUserId = id;
      this.notify();
      try {
        await fetch(`${API_BASE}/active-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
      } catch (e) {
        console.warn('Failed to sync active user to server', e);
      }
    }
  }

  async updateRoommate(id, updates) {
    if (this.state.roommates[id]) {
      this.state.roommates[id] = { ...this.state.roommates[id], ...updates };
      this.notify();
      try {
        await fetch(`${API_BASE}/roommates/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates)
        });
      } catch (e) {
        console.warn('Failed to sync roommate update', e);
      }
    }
  }

  async addExpense(expenseData) {
    // Optimistic UI update
    const tempId = 'exp_' + Date.now();
    const newExp = {
      id: tempId,
      createdAt: Date.now(),
      settled: false,
      ...expenseData
    };
    this.state.expenses.unshift(newExp);
    this.notify();

    try {
      const res = await fetch(`${API_BASE}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(expenseData)
      });
      if (res.ok) {
        const result = await res.json();
        newExp.id = result.id;
        this.fetchRemoteState(); // refresh to get consistent SQLite rows
      }
    } catch (e) {
      console.warn('Failed to persist expense to SQLite', e);
    }
    return newExp;
  }

  async deleteExpense(id) {
    this.state.expenses = this.state.expenses.filter(e => e.id !== id);
    this.notify();
    try {
      await fetch(`${API_BASE}/expenses/${id}`, { method: 'DELETE' });
    } catch (e) {
      console.warn('Failed to delete expense in SQLite', e);
    }
  }

  async settleBalance(fromId, toId, amount, note = 'Settled balance') {
    // Optimistic update
    this.state.expenses.forEach(e => {
      if (!e.settled) e.settled = true;
    });
    this.notify();

    try {
      await fetch(`${API_BASE}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromId, toId, amount, note })
      });
      this.fetchRemoteState();
    } catch (e) {
      console.warn('Failed to settle in SQLite', e);
    }
  }

  async setCalendarDay(dateStr, roommateId, status, workMode = null) {
    if (!this.state.calendar[dateStr]) this.state.calendar[dateStr] = {};
    const cur = this.state.calendar[dateStr][roommateId] || { status: 'bangalore' };
    const finalStatus = status !== undefined ? status : cur.status;
    const finalWorkMode = workMode !== null ? workMode : (finalStatus === 'home' ? null : cur.workMode);

    this.state.calendar[dateStr][roommateId] = {
      status: finalStatus,
      workMode: finalWorkMode
    };
    this.notify();

    try {
      await fetch(`${API_BASE}/calendar/day`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateStr, roommateId, status: finalStatus, workMode: finalWorkMode })
      });
    } catch (e) {
      console.warn('Failed to sync calendar day to SQLite', e);
    }
  }

  async setCalendarRange(startDateStr, endDateStr, roommateId, status) {
    let cur = new Date(startDateStr);
    const end = new Date(endDateStr);
    while (cur <= end) {
      const ds = cur.toISOString().split('T')[0];
      if (!this.state.calendar[ds]) this.state.calendar[ds] = {};
      this.state.calendar[ds][roommateId] = {
        status,
        workMode: null
      };
      cur.setDate(cur.getDate() + 1);
    }
    this.notify();

    try {
      await fetch(`${API_BASE}/calendar/range`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDateStr, endDateStr, roommateId, status })
      });
    } catch (e) {
      console.warn('Failed to sync calendar range to SQLite', e);
    }
  }

  async resetToDefault() {
    try {
      await fetch(`${API_BASE}/reset`, { method: 'POST' });
      await this.fetchRemoteState();
    } catch (e) {
      console.warn('Failed to reset SQLite DB', e);
    }
  }

  exportJSON() {
    return JSON.stringify(this.state, null, 2);
  }
}

export const store = new StateStore();
