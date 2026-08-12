const BUCKET_BADGE = {
  overdue: { label: "Overdue", emoji: "🔴", className: "text-bg-danger" },
  due_today: { label: "Due Today", emoji: "🟠", className: "text-bg-warning" },
  upcoming: { label: "Upcoming", emoji: "🔵", className: "text-bg-info" },
  completed: { label: "Completed", emoji: "🟢", className: "text-bg-success" },
};

const formatDate = (value) => {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatDateTime = (value) => {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// Read-only detail view, local to FollowUpManagement.jsx only. "View
// Student 360°"/"View Information Sheet" hand off to the EXISTING pages
// (cross-route navigation with router state — see FollowUpManagement.jsx)
// rather than building another profile screen here. Mark Completed/Edit/
// Delete delegate back to the main page's own handlers — no logic
// duplicated in this file.
function ViewFollowUpModal({ followUp, onOpenStudent, onOpenSheet, onMarkCompleted, onEdit, onDelete }) {
  const isStudent = !!followUp?.admission_id;
  const person = isStudent ? followUp?.Admission : followUp?.InformationSheet;
  const bucket = followUp ? BUCKET_BADGE[followUp.bucket] : null;

  return (
    <div className="modal fade" id="viewFollowUpModal" tabIndex="-1">
      <div className="modal-dialog">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Follow-Up Details</h5>
            <button type="button" className="btn-close" data-bs-dismiss="modal"></button>
          </div>
          {followUp && (
            <div className="modal-body">
              <div className="d-flex justify-content-between align-items-start mb-3">
                <div>
                  <span className="badge text-bg-secondary me-2">
                    {isStudent ? "Student" : "Lead"}
                  </span>
                  <span className="fw-semibold">
                    {person ? `${person.initial ? person.initial + " " : ""}${person.applicant_name || "-"}` : "-"}
                  </span>
                </div>
                {bucket && (
                  <span className={`badge ${bucket.className}`}>
                    {bucket.emoji} {bucket.label}
                  </span>
                )}
              </div>

              <div className="row g-2 mb-3">
                <div className="col-6">
                  <div className="text-muted small">Phone</div>
                  <div>{person?.mobile_no || person?.telephone_no || "-"}</div>
                </div>
                {isStudent ? (
                  <div className="col-6">
                    <div className="text-muted small">Enrolment No</div>
                    <div>{person?.comn_enrol_no || "-"}</div>
                  </div>
                ) : (
                  <div className="col-6">
                    <div className="text-muted small">Course Interested</div>
                    <div>{person?.course_interested || "-"}</div>
                  </div>
                )}
                {isStudent && (
                  <div className="col-6">
                    <div className="text-muted small">Course</div>
                    <div>{person?.course_name || "-"}</div>
                  </div>
                )}
              </div>

              <hr />

              <div className="row g-2 mb-2">
                <div className="col-6">
                  <div className="text-muted small">Follow-Up Type</div>
                  <div>{followUp.follow_up_type}</div>
                </div>
                <div className="col-6">
                  <div className="text-muted small">Status</div>
                  <div>{followUp.status}</div>
                </div>
              </div>
              <div className="mb-2">
                <div className="text-muted small">Reason</div>
                <div>{followUp.reason || "-"}</div>
              </div>
              <div className="mb-2">
                <div className="text-muted small">Note</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{followUp.note || "-"}</div>
              </div>
              <div className="row g-2 mb-2">
                <div className="col-6">
                  <div className="text-muted small">Created Date</div>
                  <div>{formatDateTime(followUp.created_at)}</div>
                </div>
                <div className="col-6">
                  <div className="text-muted small">Due Date</div>
                  <div>{formatDate(followUp.due_date)}</div>
                </div>
              </div>
              {followUp.status === "Completed" && (
                <div className="mb-2">
                  <div className="text-muted small">Completed Date</div>
                  <div>{formatDateTime(followUp.completed_at)}</div>
                </div>
              )}

              <hr />

              <div className="d-flex flex-wrap gap-2">
                {isStudent ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary"
                    onClick={() => onOpenStudent(followUp.admission_id)}
                  >
                    <i className="bi bi-person-vcard me-1"></i> View Student 360°
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary"
                    onClick={() => onOpenSheet(followUp.information_sheet_id)}
                  >
                    <i className="bi bi-clipboard-data me-1"></i> View Information Sheet
                  </button>
                )}
                {followUp.status === "Open" && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-success"
                    onClick={() => onMarkCompleted(followUp.id)}
                  >
                    <i className="bi bi-check-circle me-1"></i> Mark Completed
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => onEdit(followUp)}
                >
                  <i className="bi bi-pencil me-1"></i> Edit
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger"
                  onClick={() => onDelete(followUp.id)}
                >
                  <i className="bi bi-trash me-1"></i> Delete
                </button>
              </div>
            </div>
          )}
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ViewFollowUpModal;
