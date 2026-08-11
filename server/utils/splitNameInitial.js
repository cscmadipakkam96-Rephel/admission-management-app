// Some name-like fields bundle a person's initial into the same value:
// dot-separated in either order (e.g. "K.Yasir", "Yasir.K", "R.K. Charulatha"
// for two initials), or occasionally just space-separated with no dot at all
// (e.g. "Yasir A"). Dot-separated values are always split. Space-only values
// are split ONLY when exactly two words are present and exactly one of them
// is a single letter (an unambiguous bare initial) — anything else (e.g.
// "DINKAR SINGH", both real words) is left untouched rather than risk
// mangling a genuine multi-word name. Shared by the one-off admin scripts
// (server/scripts/*.js, run over SSH) and the automatic startup migrations
// in server/index.js — same rule, one place.
const splitNameInitial = (raw) => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.includes(".")) {
    const segments = trimmed
      .split(".")
      .map((s) => s.trim().replace(/\s+/g, " "))
      .filter((s) => s.length > 0);

    if (segments.length < 2) return null;

    const nameSegment = segments.reduce((a, b) => (b.length > a.length ? b : a));
    const initialSegments = segments.filter((s) => s !== nameSegment);
    if (initialSegments.length === 0) return null;

    const initial = initialSegments.map((s) => s.toUpperCase() + ".").join("");
    return { name: nameSegment, initial };
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length !== 2) return null;

  const [first, second] = words;
  const firstIsInitial = first.length === 1;
  const secondIsInitial = second.length === 1;
  if (firstIsInitial === secondIsInitial) return null;

  const initialWord = firstIsInitial ? first : second;
  const nameWord = firstIsInitial ? second : first;
  return { name: nameWord, initial: initialWord.toUpperCase() + "." };
};

module.exports = { splitNameInitial };
