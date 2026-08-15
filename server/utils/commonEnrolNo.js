// Institute-wide constant — same for every admission, per the physical
// enrolment register this mirrors.
const INSTITUTE_CODE = "M09";
// A=Jan .. L=Dec, straight alphabet with no skipped letters.
const MONTH_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

// "Common Enrol No" = M09 + month letter + year (2 digits) + a running
// serial. Month/year come from admission_date, falling back to created_at
// (Submitted On) when admission_date was never filled in — every admission
// has one or the other. Admissions with no Enrol No at all get NO Common
// Enrol No — there's no ground-truth order to rank them by, so making one
// up (e.g. a shared "0000") would misleadingly suggest they're all the same
// record.
//
// The serial resets to 1 at the start of every (year, month) bucket — the
// month letter alone would collide across years (Jan 2026 and Jan 2027 are
// both "A"), and within a single bucket the institute expects to see 0001
// again each month, not a number that keeps climbing all year. Ranking
// within a bucket is this admission's rank across two groups, in order:
//   1. Old plain-number Enrol Nos ("245", "271", ...) — ranked ascending by
//      that number. This is the institute's own ground-truth ordering for
//      historical/bulk-entered records, more reliable than their DB
//      insertion order.
//   2. Newer letter-prefixed Enrol Nos ("A001", "A002", ...) that started
//      once the old plain-number series ended — these don't parse as a
//      leading number, so they can't be ranked against group 1 by value
//      (e.g. "A001" would wrongly look smaller than "245"). They're instead
//      ranked by insertion order (id), which is correct for records entered
//      live, one at a time, going forward.
const buildCommonEnrolNoMap = (admissions) => {
  const withRaw = admissions
    .map((a) => {
      const effectiveDate =
        a.admission_date || (a.created_at ? new Date(a.created_at).toISOString().slice(0, 10) : null);
      return {
        id: a.id,
        raw: (a.comn_enrol_no || "").toString().trim(),
        bucketKey: effectiveDate ? effectiveDate.slice(0, 7) : null, // "YYYY-MM"
      };
    })
    .filter((a) => a.raw && a.bucketKey);

  const byBucket = new Map();
  withRaw.forEach((a) => {
    if (!byBucket.has(a.bucketKey)) byBucket.set(a.bucketKey, []);
    byBucket.get(a.bucketKey).push(a);
  });

  const rankById = new Map();
  byBucket.forEach((bucketAdmissions) => {
    const oldFormat = bucketAdmissions
      .map((a) => ({ ...a, num: parseInt(a.raw, 10) }))
      .filter((a) => Number.isFinite(a.num))
      .sort((a, b) => a.num - b.num);

    const newFormat = bucketAdmissions
      .filter((a) => !Number.isFinite(parseInt(a.raw, 10)))
      .sort((a, b) => a.id - b.id);

    [...oldFormat, ...newFormat].forEach((a, index) => rankById.set(a.id, index + 1));
  });

  const map = new Map();
  admissions.forEach((a) => {
    const rank = rankById.get(a.id);
    if (!rank) return;
    const effectiveDate = a.admission_date || new Date(a.created_at).toISOString().slice(0, 10);
    const [year, month] = effectiveDate.split("-");
    const monthLetter = MONTH_LETTERS[parseInt(month, 10) - 1];
    if (!monthLetter) return;
    const serial = String(rank).padStart(4, "0");
    map.set(a.id, `${INSTITUTE_CODE}${monthLetter}${year.slice(-2)}${serial}`);
  });
  return map;
};

module.exports = { buildCommonEnrolNoMap };
