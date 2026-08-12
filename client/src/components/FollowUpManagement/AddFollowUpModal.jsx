import { useEffect, useState } from "react";
import { Modal } from "bootstrap";
import API from "../../api/api";

export const FOLLOW_UP_TYPES = ["Attendance", "Academic", "Fee", "Enquiry", "General"];

const initialFormData = {
  follow_up_type: "General",
  reason: "",
  note: "",
  due_date: "",
  status: "Open",
};

const personName = (person) => {
  if (!person) return "";
  const initial = person.record.initial ? `${person.record.initial} ` : "";
  return `${initial}${person.record.applicant_name || ""}`.trim();
};

const personPhone = (person) =>
  person?.record.mobile_no || person?.record.telephone_no || "-";

// Shared, reusable Add/Edit modal — fixed DOM id, opened externally via
// Modal.getOrCreateInstance(document.getElementById("addFollowUpModal")).show(),
// same convention AdmissionModal.jsx already uses. Rendered independently
// by StudentRiskManagement.jsx / FeeEntry.jsx / InformationSheetEntry.jsx
// (each always passing `preselected`, person-picker never shown there) and
// by FollowUpManagement.jsx itself (own "+ Add Follow-Up" button, no
// preselected — shows the person-picker; also handles Edit via
// `editingRecord`).
function AddFollowUpModal({
  preselected,
  editingRecord,
  defaultType,
  defaultReason,
  defaultNote,
  onSaved,
}) {
  const [formData, setFormData] = useState(initialFormData);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");

  const [source, setSource] = useState("admission");
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [admissions, setAdmissions] = useState([]);
  const [sheets, setSheets] = useState([]);
  const [pickerLoaded, setPickerLoaded] = useState(false);

  const isBlankCreate = !preselected && !editingRecord;

  useEffect(() => {
    if (editingRecord) {
      setFormData({
        follow_up_type: editingRecord.follow_up_type || "General",
        reason: editingRecord.reason || "",
        note: editingRecord.note || "",
        due_date: editingRecord.due_date || "",
        status: editingRecord.status || "Open",
      });
      setSelectedPerson(
        editingRecord.admission_id
          ? { type: "admission", record: editingRecord.Admission || { id: editingRecord.admission_id } }
          : { type: "information_sheet", record: editingRecord.InformationSheet || { id: editingRecord.information_sheet_id } }
      );
    } else if (preselected) {
      setFormData({
        ...initialFormData,
        follow_up_type: defaultType || "General",
        reason: defaultReason || "",
        note: defaultNote || "",
      });
      setSelectedPerson(preselected);
    } else {
      setFormData(initialFormData);
      setSelectedPerson(null);
      setSource("admission");
      setSearchTerm("");
    }
    setErrors({});
    setServerError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselected, editingRecord]);

  useEffect(() => {
    if (!isBlankCreate || pickerLoaded) return;
    Promise.all([API.get("/admissions?active=true"), API.get("/information-sheets?active=true")])
      .then(([admissionsRes, sheetsRes]) => {
        setAdmissions(admissionsRes.data.data);
        setSheets(sheetsRes.data.data);
        setPickerLoaded(true);
      })
      .catch(() => {
        // Person picker lists are secondary here; ignore failures silently.
      });
  }, [isBlankCreate, pickerLoaded]);

  const searchResults = searchTerm.trim()
    ? (source === "admission" ? admissions : sheets).filter((p) => {
        const term = searchTerm.toLowerCase();
        return (
          (p.applicant_name || "").toLowerCase().includes(term) ||
          (p.mobile_no || "").toLowerCase().includes(term) ||
          (p.comn_enrol_no || "").toLowerCase().includes(term)
        );
      })
    : [];

  const pickPerson = (record) => {
    setSelectedPerson({ type: source, record });
    setSearchTerm("");
    setErrors((prev) => {
      if (!prev.source) return prev;
      const next = { ...prev };
      delete next.source;
      return next;
    });
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const closeModal = () => {
    Modal.getOrCreateInstance(document.getElementById("addFollowUpModal")).hide();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const nextErrors = {};
    if (!formData.follow_up_type) nextErrors.follow_up_type = "Select a follow-up type.";
    if (!formData.due_date) nextErrors.due_date = "Due date is required.";
    if (!selectedPerson) nextErrors.source = "Select a Student or an Enquiry.";
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setServerError("");
    setSubmitting(true);
    try {
      const payload = {
        follow_up_type: formData.follow_up_type,
        reason: formData.reason,
        note: formData.note,
        due_date: formData.due_date,
        status: formData.status,
      };
      if (!editingRecord) {
        if (selectedPerson.type === "admission") payload.admission_id = selectedPerson.record.id;
        else payload.information_sheet_id = selectedPerson.record.id;
      }
      const response = editingRecord
        ? await API.put(`/follow-ups/${editingRecord.id}`, payload)
        : await API.post("/follow-ups", payload);
      closeModal();
      onSaved?.(response.data.message);
    } catch (err) {
      const serverErrors = err.response?.data?.errors;
      if (serverErrors) {
        setErrors(serverErrors);
      } else {
        setServerError(err.response?.data?.message || "Failed to save follow-up.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal fade" id="addFollowUpModal" tabIndex="-1">
      <div className="modal-dialog">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              {editingRecord ? "Edit Follow-Up" : "Add Follow-Up"}
            </h5>
            <button type="button" className="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              {serverError && <div className="alert alert-danger py-2">{serverError}</div>}

              {isBlankCreate && !selectedPerson && (
                <>
                  <div className="btn-group btn-group-sm mb-2" role="group">
                    <button
                      type="button"
                      className={`btn ${source === "admission" ? "btn-primary" : "btn-outline-primary"}`}
                      onClick={() => {
                        setSource("admission");
                        setSearchTerm("");
                      }}
                    >
                      Student
                    </button>
                    <button
                      type="button"
                      className={`btn ${source === "information_sheet" ? "btn-primary" : "btn-outline-primary"}`}
                      onClick={() => {
                        setSource("information_sheet");
                        setSearchTerm("");
                      }}
                    >
                      Enquiry
                    </button>
                  </div>
                  <div className="position-relative mb-3">
                    <input
                      type="text"
                      className={`form-control ${errors.source ? "is-invalid" : ""}`}
                      placeholder={
                        source === "admission"
                          ? "Search by Name, Enrolment No, or Mobile..."
                          : "Search by Name or Mobile..."
                      }
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {errors.source && <div className="invalid-feedback">{errors.source}</div>}
                    {searchResults.length > 0 && (
                      <div
                        className="list-group position-absolute w-100 shadow-sm"
                        style={{ zIndex: 10, maxHeight: "220px", overflowY: "auto" }}
                      >
                        {searchResults.map((p) => (
                          <button
                            type="button"
                            key={p.id}
                            className="list-group-item list-group-item-action"
                            onClick={() => pickPerson(p)}
                          >
                            <strong>{p.applicant_name}</strong>
                            {source === "admission"
                              ? ` — ${p.comn_enrol_no || "no enrol no"}`
                              : ` — ${p.mobile_no || "no mobile"}`}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {selectedPerson && (
                <div className="border rounded-3 p-3 mb-3 bg-light-subtle">
                  <div className="d-flex justify-content-between align-items-start">
                    <div>
                      <div className="text-uppercase text-muted small fw-bold mb-1">
                        {selectedPerson.type === "admission" ? "Student" : "Enquiry"}
                      </div>
                      <div className="fw-semibold">{personName(selectedPerson)}</div>
                      {selectedPerson.type === "admission" ? (
                        <div className="text-muted small">
                          Enrolment: {selectedPerson.record.comn_enrol_no || "-"}
                        </div>
                      ) : (
                        <div className="text-muted small">
                          Course Interested: {selectedPerson.record.course_interested || "-"}
                        </div>
                      )}
                      <div className="text-muted small">Phone: {personPhone(selectedPerson)}</div>
                    </div>
                    {isBlankCreate && !editingRecord && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => setSelectedPerson(null)}
                      >
                        Change
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="mb-3">
                <label className="form-label">Follow-Up Type</label>
                <select
                  name="follow_up_type"
                  className={`form-select ${errors.follow_up_type ? "is-invalid" : ""}`}
                  value={formData.follow_up_type}
                  onChange={handleChange}
                >
                  {FOLLOW_UP_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                {errors.follow_up_type && (
                  <div className="invalid-feedback">{errors.follow_up_type}</div>
                )}
              </div>

              <div className="mb-3">
                <label className="form-label">Reason</label>
                <input
                  type="text"
                  name="reason"
                  className="form-control"
                  placeholder="e.g. Low Attendance"
                  value={formData.reason}
                  onChange={handleChange}
                />
              </div>

              <div className="mb-3">
                <label className="form-label">Note</label>
                <textarea
                  name="note"
                  className="form-control"
                  rows={3}
                  placeholder="e.g. Call parent and explain attendance issue."
                  value={formData.note}
                  onChange={handleChange}
                ></textarea>
              </div>

              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label">Due Date</label>
                  <input
                    type="date"
                    name="due_date"
                    className={`form-control ${errors.due_date ? "is-invalid" : ""}`}
                    value={formData.due_date}
                    onChange={handleChange}
                  />
                  {errors.due_date && <div className="invalid-feedback">{errors.due_date}</div>}
                </div>
                {editingRecord && (
                  <div className="col-md-6">
                    <label className="form-label">Status</label>
                    <select
                      name="status"
                      className="form-select"
                      value={formData.status}
                      onChange={handleChange}
                    >
                      <option value="Open">Open</option>
                      <option value="Completed">Completed</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? "Saving..." : "Save Follow-Up"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default AddFollowUpModal;
