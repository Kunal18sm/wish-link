const CREDIT_TIMEZONE = process.env.CREDIT_TIMEZONE || "Asia/Kolkata";
const DAILY_REWARD_BY_DAY = {
  mon: 1,
  tue: 1,
  wed: 1,
  thu: 1,
  fri: 1,
  sat: 2,
  sun: 3,
};

function formatInTimeZone(date, options) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CREDIT_TIMEZONE,
    ...options,
  }).format(date);
}

function getCreditDateKey(date = new Date()) {
  const year = formatInTimeZone(date, { year: "numeric" });
  const month = formatInTimeZone(date, { month: "2-digit" });
  const day = formatInTimeZone(date, { day: "2-digit" });
  return `${year}-${month}-${day}`;
}

function getDailyRewardCredits(date = new Date()) {
  const weekday = getCreditWeekdayKey(date);
  return DAILY_REWARD_BY_DAY[weekday] || 1;
}

function getCreditWeekdayKey(date = new Date()) {
  return formatInTimeZone(date, { weekday: "short" }).toLowerCase().slice(0, 3);
}

module.exports = {
  CREDIT_TIMEZONE,
  DAILY_REWARD_BY_DAY,
  getCreditDateKey,
  getDailyRewardCredits,
  getCreditWeekdayKey,
};
