// Pure domain logic for billing periods (no I/O)

export function getCurrentPeriod(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();

  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));

  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
    year,
    month: month + 1,
  };
}

export function getPeriodForDate(dateString) {
  const date = new Date(dateString + 'T00:00:00Z');
  return getCurrentPeriod(date);
}

export function isDateInPeriod(dateString, periodStart, periodEnd) {
  return dateString >= periodStart && dateString <= periodEnd;
}

export function secondsUntilNextPeriod(date = new Date()) {
  const current = getCurrentPeriod(date);
  const nextPeriod = new Date(current.end + 'T23:59:59Z');
  const now = new Date(date);
  const diff = nextPeriod.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / 1000));
}
