// Shared with AdmissionModal.jsx (auto-sync on save) and List.jsx (bulk
// sync). This must run client-side, never server-side — the Flutter app's
// backend is a local-dev-only URL that only resolves on whoever's browser
// is open right now, not on our own EC2-hosted backend.
const STUDENT_APP_REGISTER_URL = "http://localhost:5000/api/register";
export const studentAppRecordUrl = (comnEnrolNo) =>
  `http://localhost:5000/api/register/${encodeURIComponent(comnEnrolNo)}`;

// The Flutter app logs students in with comn_enrol_no + their date of
// birth (DDMMYYYY) as the password — so these four are the only fields
// that matter for registration; anything else on the admission is
// irrelevant to it.
export const hasRequiredStudentAppFields = (admission) =>
  Boolean(
    admission?.comn_enrol_no?.toString().trim() &&
      admission?.applicant_name?.toString().trim() &&
      admission?.email?.toString().trim() &&
      admission?.date_of_birth
  );

// Fire-and-forget by design at the call sites — a Flutter backend that's
// not running right now shouldn't block saving an admission. Callers
// decide whether/how to surface failures.
export const registerToStudentApp = async (admission) => {
  const response = await fetch(STUDENT_APP_REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      comn_enrol_no: admission.comn_enrol_no.toString().trim(),
      name: admission.applicant_name.toString().trim(),
      gmail: admission.email.toString().trim(),
      date_of_birth: admission.date_of_birth,
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || "Registration failed.");
  }
  return data;
};
