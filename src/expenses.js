// Homie Expense Calculation Engine, UPI Linker, and Quick Split Helpers
import { store, CATEGORIES } from './state.js';

export function calculateBalances(state) {
  const r1 = state.roommates.r1;
  const r2 = state.roommates.r2;
  const activeId = state.activeUserId;
  const otherId = activeId === 'r1' ? 'r2' : 'r1';

  let r1Net = 0; // positive means r1 is owed money, negative means r1 owes r2

  const unsettledExpenses = state.expenses.filter(e => !e.settled);

  for (const exp of unsettledExpenses) {
    const payer = exp.payerId;
    const r1Share = exp.shares?.r1 ?? (exp.amount / 2);
    const r2Share = exp.shares?.r2 ?? (exp.amount / 2);

    if (payer === 'r1') {
      // r1 paid the whole amount, r2 owes their share to r1
      r1Net += r2Share;
    } else if (payer === 'r2') {
      // r2 paid the whole amount, r1 owes their share to r2
      r1Net -= r1Share;
    }
  }

  // Round to nearest integer or 2 decimal places
  r1Net = Math.round(r1Net * 100) / 100;

  const activeNet = activeId === 'r1' ? r1Net : -r1Net;
  const activeUser = state.roommates[activeId];
  const otherUser = state.roommates[otherId];

  let statusText = '';
  let subText = '';
  let debtorId = null;
  let creditorId = null;
  let settleAmount = Math.abs(activeNet);

  if (Math.abs(activeNet) < 0.5) {
    statusText = "All squared away! 🥐";
    subText = "No pending debts between you and " + otherUser.name;
  } else if (activeNet > 0) {
    statusText = `${otherUser.name} owes you ₹${Math.round(activeNet).toLocaleString('en-IN')}`;
    subText = `Ready to settle up when you are`;
    debtorId = otherId;
    creditorId = activeId;
  } else {
    statusText = `You owe ${otherUser.name} ₹${Math.round(settleAmount).toLocaleString('en-IN')}`;
    subText = `Pay back your homie in one click`;
    debtorId = activeId;
    creditorId = otherId;
  }

  return {
    activeNet,
    settleAmount: Math.round(settleAmount),
    statusText,
    subText,
    debtorId,
    creditorId,
    activeUser,
    otherUser,
    unsettledCount: unsettledExpenses.length,
    totalUnsettledSpend: Math.round(unsettledExpenses.reduce((sum, e) => sum + e.amount, 0))
  };
}

export function generateUpiUrl(receiverUpi, receiverName, amount, note = 'Homie flat expense split') {
  if (!receiverUpi) return '';
  const cleanUpi = receiverUpi.trim();
  const cleanName = encodeURIComponent(receiverName || 'Homie Flatmate');
  const cleanNote = encodeURIComponent(note);
  return `upi://pay?pa=${cleanUpi}&pn=${cleanName}&am=${amount}&cu=INR&tn=${cleanNote}`;
}

export function generateQrUrl(upiUrl) {
  if (!upiUrl) return '';
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=10&data=${encodeURIComponent(upiUrl)}`;
}

export function getCategoryById(catId) {
  return CATEGORIES.find(c => c.id === catId) || CATEGORIES[CATEGORIES.length - 1];
}

export function formatCurrency(num) {
  if (isNaN(num)) return '₹0';
  return '₹' + Math.round(num).toLocaleString('en-IN');
}

export function formatDateFriendly(dateStr) {
  if (!dateStr) return '';
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';

  const [y, m, d] = dateStr.split('-');
  const dateObj = new Date(y, parseInt(m) - 1, d);
  return dateObj.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}
