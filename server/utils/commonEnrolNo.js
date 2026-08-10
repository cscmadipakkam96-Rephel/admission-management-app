// Institute-wide constant — same for every admission, per the physical
// enrolment register this mirrors.
const INSTITUTE_CODE = "M09";
// A=Jan .. L=Dec, straight alphabet with no skipped letters.
const MONTH_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

// "Common Enrol No" = M09 + month letter + year (2 digits) + a running
// serial. Month/year come from admission_date, falling back to created_at
// (Submitted On) when admission_date was never filled in — every admission
// has one or the other. The serial is this admission's rank when every
// admission is sorted by its existing Enrol No (comn_enrol_no) ascending —
// that field is the institute's own ground-truth ordering, more reliable
// than timestamps on bulk-entered historical records. Admissions with no
// Enrol No at all get NO Common Enrol No — there's no ground-truth order to
// rank them by, so making one up (e.g. a shared "0000") would misleadingly
// suggest they're all the same record.
const buildCommonEnrolNoMap = (admissions) => {
  const withEnrol = admissions
    .map((a) => ({ id: a.id, enrolNum: parseInt(a.comn_enrol_no, 10) }))
    .filter((a) => Number.isFinite(a.enrolNum))
    .sort((a, b) => a.enrolNum - b.enrolNum);

  const rankById = new Map();
  withEnrol.forEach((a, index) => rankById.set(a.id, index + 1));

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
