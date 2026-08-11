const parseTimeToken = (token) => {
  const match = token.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  return {
    hour: parseInt(match[1], 10),
    minute: match[2] ? parseInt(match[2], 10) : 0,
    ampm: match[3] ? match[3].toUpperCase() : null,
  };
};

const to24 = (t) => {
  let h = t.hour;
  if (t.ampm === "PM" && h !== 12) h += 12;
  if (t.ampm === "AM" && h === 12) h = 0;
  return h * 60 + t.minute;
};

// Parses a free-typed timing value into a { start, end } minutes-since-
// midnight range. Handles "9-11am", "9:00 AM - 11:00 AM", "9 to 11", and a
// single time ("9pm") — treated as a zero-width point. Returns null if it
// can't confidently resolve AM/PM on at least one side (mirrors the
// leniency of server/utils/timeRange.js's parseTimeRange: a missing AM/PM
// on one side inherits the other side's).
export function parseTimingRange(raw) {
  if (!raw || !raw.trim()) return null;
  const normalized = raw.trim().replace(/\s*to\s*/gi, "-");
  const parts = normalized
    .split("-")
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 2) {
    const a = parseTimeToken(parts[0]);
    const b = parseTimeToken(parts[1]);
    if (!a || !b) return null;
    if (!a.ampm && b.ampm) a.ampm = b.ampm;
    if (!b.ampm && a.ampm) b.ampm = a.ampm;
    if (!a.ampm || !b.ampm) return null;
    return { start: to24(a), end: to24(b) };
  }
  if (parts.length === 1) {
    const a = parseTimeToken(parts[0]);
    if (!a || !a.ampm) return null;
    const point = to24(a);
    return { start: point, end: point };
  }
  return null;
}

// "match" = the student's free-typed timing overlaps/contains the batch's
// time window, "different" = both parsed fine but don't overlap, "unknown"
// = the student's timing is blank or couldn't be confidently parsed. Never
// throws — callers use the status only to pick a display badge, students
// are never hidden based on it.
export function matchTimingStatus(studentTimingRaw, batchStart, batchEnd) {
  if (batchStart == null || batchEnd == null) return "unknown";
  const studentRange = parseTimingRange(studentTimingRaw);
  if (!studentRange) return "unknown";
  const overlaps = studentRange.start <= batchEnd && batchStart <= studentRange.end;
  return overlaps ? "match" : "different";
}
