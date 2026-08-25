// Shared with AdmissionModal.jsx (auto-sync on save + rename handling) and
// List.jsx (bulk sync + counts). Deliberately hardcoded rather than
// env-configured — this is the separate Flutter app's own backend, not
// ours, so it doesn't belong in this app's deploy config.
const STUDENT_APP_BASE_URL = "https://13-62-125-222.sslip.io";
const STUDENT_APP_REGISTER_URL = `${STUDENT_APP_BASE_URL}/api/register`;
export const studentAppRecordUrl = (comnEnrolNo) =>
  `${STUDENT_APP_BASE_URL}/api/register/${encodeURIComponent(comnEnrolNo)}`;

// The Flutter app logs students in with comn_enrol_no + their date of
// birth (DDMMYYYY) as the password — so these three are the only fields
// that matter for registration; anything else on the admission is
// irrelevant to it.
export const hasRequiredStudentAppFields = (admission) =>
  Boolean(
    admission?.comn_enrol_no?.toString().trim() &&
      admission?.applicant_name?.toString().trim() &&
      admission?.date_of_birth
  );

// Fire-and-forget by design at the call sites — a Flutter backend hiccup
// shouldn't block saving an admission. Callers decide whether/how to
// surface failures.
export const registerToStudentApp = async (admission) => {
  const response = await fetch(STUDENT_APP_REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      comn_enrol_no: admission.comn_enrol_no.toString().trim(),
      name: admission.applicant_name.toString().trim(),
      date_of_birth: admission.date_of_birth,
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || "Registration failed.");
  }
  return data;
};

export const checkStudentAppRegistered = async (comnEnrolNo) => {
  const response = await fetch(studentAppRecordUrl(comnEnrolNo));
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || "Status check failed.");
  }
  return Boolean(data.exists);
};

export const deleteFromStudentApp = async (comnEnrolNo) => {
  const response = await fetch(studentAppRecordUrl(comnEnrolNo), {
    method: "DELETE",
  });
  const data = await response.json();
  // 404 (never registered under that number) isn't a failure worth
  // surfacing to callers doing a rename cleanup — nothing to remove.
  if (!response.ok && response.status !== 404) {
    throw new Error(data.error || "Remove failed.");
  }
  return data;
};
