// Mirrors the portal page: a date-only value means the end of that local day.
function parseDate(v) {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Locked unless a reopened window is currently open. A reopened window that has
// passed (changesUntil in the past) counts as locked even if Locked On is empty,
// because the scheduled-lock workflow in GHL may not have run yet.
function isLocked(status, now = new Date()) {
  const until = parseDate(status && status.changesUntil);
  if (until && until > now) return false;
  if (status && status.lockedOn) return true;
  if (until) return true;
  return false;
}

// not_started | in_progress | submitted | reopened
function portalState(status, hasData, now = new Date()) {
  const until = parseDate(status && status.changesUntil);
  if (until && until > now && !(status && status.lockedOn)) return 'reopened';
  if (isLocked(status, now)) return 'submitted';
  return hasData ? 'in_progress' : 'not_started';
}

module.exports = { parseDate, isLocked, portalState };
