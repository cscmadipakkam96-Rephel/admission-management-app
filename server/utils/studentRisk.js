// Classifies a student into at_risk / needs_attention / on_track for the
// Student Risk Management view, purely from data server/controllers/
// batchController.js's getStudentTracking already computes (attendance %,
// last-attended date, fee status) — no new queries, no schema changes.
//
// Only 3 signals are used, deliberately. getStudentTracking derives topic
// "completion" from the Attendance row for that date (a topic only counts
// as done if the student was marked Present that day — campus-entry
// attendance isn't cross-checked into it yet), so an "academic progress %"
// built the same way (completedTopics/totalTopics) would always equal
// attendancePercent exactly — using both as independent signals would
// double-count one real problem as two. Engagement (attendance) already
// covers that ground; Attendance Gap and Fee are the two genuinely
// separate signals available today.
//
// Severity per signal is none / moderate / serious:
//   1. Engagement (attendance %) — reuses StudentTracking.jsx's own
//      ATTENDANCE_BUCKET boundaries (>=75 none, 50-74 moderate, <50
//      serious) so this view never contradicts the existing 360 language.
//      Skipped if totalClasses is 0 (no classes have happened yet).
//   2. Attendance gap — days since lastAttendedDate. Serious at >=14 days,
//      or "never attended" despite totalClasses>0. Moderate at 7-13 days.
//      Skipped if totalClasses is 0.
//   3. Fee — moderate (never serious) if status is "Pending" or
//      "Partially Paid" — the spec this was built against lists a pending
//      fee balance only under "Needs Attention", never under "At Risk" on
//      its own; it still escalates to at_risk via the "2+ moderate
//      signals" rule below if it coincides with an attendance problem.
//      None if "Paid" or "Fee Not Set" (don't penalize missing fee config).
//
// Combining rule:
//   any serious            -> at_risk
//   moderate count >= 2    -> at_risk ("multiple issues together")
//   moderate count >= 1    -> needs_attention
//   otherwise              -> on_track

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const toUtcMidnight = (dateLike) => {
  const d = new Date(dateLike);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
};

const daysBetween = (fromDateLike, toDateLike) =>
  Math.round((toUtcMidnight(toDateLike) - toUtcMidnight(fromDateLike)) / MS_PER_DAY);

const classifyStudentRisk = ({
  attendancePercent,
  totalClasses,
  lastAttendedDate,
  feeStatus,
  feeBalance,
  today,
}) => {
  const reasons = [];
  const severities = [];

  if (totalClasses > 0) {
    if (attendancePercent < 50) {
      severities.push("serious");
      reasons.push(`Attendance ${attendancePercent}%`);
    } else if (attendancePercent < 75) {
      severities.push("moderate");
      reasons.push(`Attendance ${attendancePercent}%`);
    }

    if (!lastAttendedDate) {
      severities.push("serious");
      reasons.push("Never attended a class yet");
    } else {
      const gapDays = daysBetween(lastAttendedDate, today);
      if (gapDays >= 14) {
        severities.push("serious");
        reasons.push(`Last attended ${gapDays} days ago`);
      } else if (gapDays >= 7) {
        severities.push("moderate");
        reasons.push(`Last attended ${gapDays} days ago`);
      }
    }
  }

  if (feeStatus === "Pending") {
    severities.push("moderate");
    reasons.push(
      feeBalance != null ? `Fee pending — Rs. ${feeBalance}` : "Fee pending"
    );
  } else if (feeStatus === "Partially Paid") {
    severities.push("moderate");
    reasons.push(
      feeBalance != null
        ? `Partial fee payment — Rs. ${feeBalance} pending`
        : "Partial fee payment"
    );
  }

  const moderateCount = severities.filter((s) => s === "moderate").length;
  const hasSerious = severities.includes("serious");

  let riskStatus;
  if (hasSerious || moderateCount >= 2) {
    riskStatus = "at_risk";
  } else if (moderateCount >= 1) {
    riskStatus = "needs_attention";
  } else {
    riskStatus = "on_track";
  }

  return { riskStatus, riskReasons: reasons };
};

module.exports = { classifyStudentRisk };
