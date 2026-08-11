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
// single time ("9pm") — treated as a zero-width point. A missing AM/PM on
// one side inherits the other side's (mirrors server/utils/timeRange.js's
// parseTimeRange leniency); if NEITHER side has one at all (e.g. "10-12"),
// defaults to PM — same convention AdmissionCharts.jsx's normalizeTiming
// already uses for the same ambiguity, so "10-12" reads consistently
// across the app instead of being unmatchable here. Returns null only for
// genuinely unparseable text.
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
    if (!a.ampm && !b.ampm) a.ampm = b.ampm = "PM";
    return { start: to24(a), end: to24(b) };
  }
  if (parts.length === 1) {
    const a = parseTimeToken(parts[0]);
    if (!a) return null;
    if (!a.ampm) a.ampm = "PM";
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

// Shared tab config for the 3-way student filter used when picking a
// batch's students (Batch Management + the teacher's own Create Batch
// form) — one source of truth for labels/colors/default tab so both
// stay in sync.
export const TIMING_STATUS_TABS = [
  { key: "match", label: "Time Matches", activeCls: "btn-success", outlineCls: "btn-outline-success" },
  { key: "different", label: "Different Timing", activeCls: "btn-warning", outlineCls: "btn-outline-warning" },
  { key: "unknown", label: "No timing info", activeCls: "btn-secondary", outlineCls: "btn-outline-secondary" },
];
