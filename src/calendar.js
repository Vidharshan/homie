// Homie Bangalore vs Home Travel Calendar with Subtle WFH/WFO Ambient Badges
import { store } from './state.js';

export function getMonthDays(year, monthIndex) {
  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);

  const days = [];
  const startDayOfWeek = (firstDay.getDay() + 6) % 7; // Monday as 0, Sunday as 6

  // Pad previous month days
  const prevMonthLastDay = new Date(year, monthIndex, 0).getDate();
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const d = prevMonthLastDay - i;
    const prevDate = new Date(year, monthIndex - 1, d);
    days.push({
      dateStr: prevDate.toISOString().split('T')[0],
      dayNumber: d,
      isCurrentMonth: false,
      dateObj: prevDate
    });
  }

  // Current month days
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const curDate = new Date(year, monthIndex, d);
    days.push({
      dateStr: curDate.toISOString().split('T')[0],
      dayNumber: d,
      isCurrentMonth: true,
      dateObj: curDate
    });
  }

  // Pad next month days to complete 35 or 42 grid cells
  const remaining = (7 - (days.length % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const nextDate = new Date(year, monthIndex + 1, d);
    days.push({
      dateStr: nextDate.toISOString().split('T')[0],
      dayNumber: d,
      isCurrentMonth: false,
      dateObj: nextDate
    });
  }

  return days;
}

export function getDayPresence(state, dateStr) {
  const cal = state.calendar || {};
  const dayData = cal[dateStr] || {};

  const r1Data = dayData.r1 || { status: 'bangalore', workMode: null };
  const r2Data = dayData.r2 || { status: 'bangalore', workMode: null };

  const r1InBlr = (r1Data.status || 'bangalore') === 'bangalore';
  const r2InBlr = (r2Data.status || 'bangalore') === 'bangalore';

  let vibe = 'both_blr';
  let vibeText = '🏡 Both at flat in Bangalore';
  let vibeSub = 'High chance of ordering midnight food together';

  if (r1InBlr && r2InBlr) {
    vibe = 'both_blr';
    vibeText = '🏡 Full House (Bangalore)';
    vibeSub = 'Both of you are at the flat';
  } else if (!r1InBlr && !r2InBlr) {
    vibe = 'both_away';
    vibeText = '✈️ Flat is quiet';
    vibeSub = 'Both of you are traveling home';
  } else if (r1InBlr && !r2InBlr) {
    vibe = 'r1_solo';
    const r1Name = state.roommates.r1.name;
    const r2Name = state.roommates.r2.name;
    vibeText = `🧘 ${r1Name} holding down the fort`;
    vibeSub = `${r2Name} is visiting home`;
  } else {
    vibe = 'r2_solo';
    const r1Name = state.roommates.r1.name;
    const r2Name = state.roommates.r2.name;
    vibeText = `🧘 ${r2Name} holding down the fort`;
    vibeSub = `${r1Name} is visiting home`;
  }

  return {
    r1: {
      status: r1Data.status || 'bangalore',
      workMode: r1InBlr ? (r1Data.workMode || null) : null
    },
    r2: {
      status: r2Data.status || 'bangalore',
      workMode: r2InBlr ? (r2Data.workMode || null) : null
    },
    vibe,
    vibeText,
    vibeSub
  };
}

export function calculateMonthlyStats(state, year, monthIndex) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  let sharedDays = 0;
  let soloDays = 0;
  let bothAway = 0;

  for (let d = 1; d <= lastDay; d++) {
    const curDate = new Date(year, monthIndex, d);
    const ds = curDate.toISOString().split('T')[0];
    const presence = getDayPresence(state, ds);
    if (presence.vibe === 'both_blr') sharedDays++;
    else if (presence.vibe === 'both_away') bothAway++;
    else soloDays++;
  }

  return {
    totalDays: lastDay,
    sharedDays,
    soloDays,
    bothAway
  };
}
