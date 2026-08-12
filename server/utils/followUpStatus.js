// Classifies a follow-up into one of 4 buckets for Follow-Up Management's
// summary cards/badges, purely from status + due_date. Plain "YYYY-MM-DD"
// string comparison (matching the established idiom in commonEnrolNo.js/
// AdmissionReportCard.jsx) — DATEONLY strings compare correctly as strings,
// no Date object needed.
const classifyFollowUpBucket = ({ status, due_date, today }) => {
  if (status === "Completed") return "completed";
  if (due_date < today) return "overdue";
  if (due_date === today) return "due_today";
  return "upcoming";
};

module.exports = { classifyFollowUpBucket };
