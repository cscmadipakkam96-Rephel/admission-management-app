// Some name-like fields bundle a person's initial into the same value,
// dot-separated in either order (e.g. "K.Yasir", "Yasir.K", "R.K. Charulatha"
// for two initials). Only values containing a "." are touched — space-
// separated names with no dot (e.g. "DINKAR SINGH") are ambiguous and left
// untouched rather than risk mangling a genuine two-word name. Shared by
// the one-off admin scripts (server/scripts/*.js, run over SSH) and the
// automatic startup migration in server/index.js — same rule, one place.
const splitNameInitial = (raw) => {
  if (!raw || !raw.includes(".")) return null;

  const segments = raw
    .split(".")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.length > 0);

  if (segments.length < 2) return null;

  const nameSegment = segments.reduce((a, b) => (b.length > a.length ? b : a));
  const initialSegments = segments.filter((s) => s !== nameSegment);
  if (initialSegments.length === 0) return null;

  const initial = initialSegments.map((s) => s.toUpperCase() + ".").join("");
  return { name: nameSegment, initial };
};

module.exports = { splitNameInitial };
