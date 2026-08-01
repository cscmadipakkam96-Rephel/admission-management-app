import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Modal } from "bootstrap";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import API from "../../api/api";

const initialSubjectForm = {
  subject_name: "",
  description: "",
  syllabus: "",
};

let rowKeySeq = 0;
const newRowKey = () => `new-${Date.now()}-${rowKeySeq++}`;

function SubjectManagement() {
  const subjectModalRef = useRef(null);
  const deleteModalRef = useRef(null);
  const viewModalRef = useRef(null);

  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [toast, setToast] = useState(null);

  const [editingSubjectId, setEditingSubjectId] = useState(null);
  const [subjectForm, setSubjectForm] = useState(initialSubjectForm);
  const [subjectErrors, setSubjectErrors] = useState({});
  const [subSubjectRows, setSubSubjectRows] = useState([]);
  const [rowErrors, setRowErrors] = useState({});
  const [removedSubSubjectIds, setRemovedSubSubjectIds] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  const [viewSubject, setViewSubject] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const ROWS_PER_PAGE = 10;

  const fetchSubjects = async () => {
    try {
      const response = await API.get("/subjects?active=true");
      setSubjects(response.data.data);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load subjects.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubjects();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const forceCleanup = () => {
      document.querySelectorAll(".modal-backdrop").forEach((el) => el.remove());
      document.body.classList.remove("modal-open");
      document.body.style.removeProperty("overflow");
      document.body.style.removeProperty("padding-right");
    };
    const els = [subjectModalRef.current, deleteModalRef.current, viewModalRef.current];
    if (els.some((el) => !el)) return;
    els.forEach((el) => el.addEventListener("hidden.bs.modal", forceCleanup));
    return () => {
      els.forEach((el) =>
        el.removeEventListener("hidden.bs.modal", forceCleanup)
      );
    };
  }, [loading]);

  const filteredSubjects = subjects.filter((s) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const matchesSubject =
      (s.subject_name || "").toLowerCase().includes(term) ||
      (s.description || "").toLowerCase().includes(term) ||
      (s.syllabus || "").toLowerCase().includes(term);
    if (matchesSubject) return true;
    return (s.SubSubjects || []).some(
      (sub) =>
        (sub.subject_name || "").toLowerCase().includes(term) ||
        (sub.syllabus || "").toLowerCase().includes(term)
    );
  });

  const totalSubSubjects = subjects.reduce(
    (sum, s) => sum + (s.SubSubjects?.length || 0),
    0
  );

  const totalPages = Math.max(
    1,
    Math.ceil(filteredSubjects.length / ROWS_PER_PAGE)
  );
  const paginatedSubjects = filteredSubjects.slice(
    (currentPage - 1) * ROWS_PER_PAGE,
    currentPage * ROWS_PER_PAGE
  );

  const openAddSubjectModal = () => {
    setEditingSubjectId(null);
    setSubjectForm(initialSubjectForm);
    setSubjectErrors({});
    setSubSubjectRows([]);
    setRowErrors({});
    setRemovedSubSubjectIds([]);
    Modal.getOrCreateInstance(subjectModalRef.current).show();
  };

  const openEditSubjectModal = (subject) => {
    setEditingSubjectId(subject.id);
    setSubjectForm({
      subject_name: subject.subject_name || "",
      description: subject.description || "",
      syllabus: subject.syllabus || "",
    });
    setSubjectErrors({});
    setSubSubjectRows(
      (subject.SubSubjects || []).map((sub) => ({
        key: sub.id,
        id: sub.id,
        subject_name: sub.subject_name || "",
        syllabus: sub.syllabus || "",
      }))
    );
    setRowErrors({});
    setRemovedSubSubjectIds([]);
    Modal.getOrCreateInstance(subjectModalRef.current).show();
  };

  const closeSubjectModal = () => {
    Modal.getOrCreateInstance(subjectModalRef.current).hide();
  };

  const handleSubjectChange = (e) => {
    const { name, value } = e.target;
    setSubjectForm((prev) => ({ ...prev, [name]: value }));
    setSubjectErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const addSubSubjectRow = () => {
    setSubSubjectRows((prev) => [
      ...prev,
      { key: newRowKey(), id: null, subject_name: "", syllabus: "" },
    ]);
  };

  const handleRowChange = (key, field, value) => {
    setSubSubjectRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, [field]: value } : row))
    );
    setRowErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const removeSubSubjectRow = (row) => {
    if (row.id) {
      setRemovedSubSubjectIds((prev) => [...prev, row.id]);
    }
    setSubSubjectRows((prev) => prev.filter((r) => r.key !== row.key));
    setRowErrors((prev) => {
      if (!prev[row.key]) return prev;
      const next = { ...prev };
      delete next[row.key];
      return next;
    });
  };

  const handleSubjectSubmit = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!subjectForm.subject_name.trim()) {
      errors.subject_name = "Subject Name is required.";
    }
    const newRowErrors = {};
    subSubjectRows.forEach((row) => {
      if (!row.subject_name.trim()) {
        newRowErrors[row.key] = "Sub-Subject Name is required.";
      }
    });
    if (Object.keys(errors).length || Object.keys(newRowErrors).length) {
      setSubjectErrors(errors);
      setRowErrors(newRowErrors);
      return;
    }

    setSubmitting(true);
    try {
      const subjectPayload = {
        subject_name: subjectForm.subject_name,
        description: subjectForm.description,
        syllabus: subSubjectRows.length === 0 ? subjectForm.syllabus : "",
      };

      let subjectId = editingSubjectId;
      try {
        if (editingSubjectId) {
          await API.put(`/subjects/${editingSubjectId}`, subjectPayload);
        } else {
          const response = await API.post("/subjects", subjectPayload);
          subjectId = response.data.data.id;
        }
      } catch (err) {
        const serverErrors = err.response?.data?.errors;
        if (serverErrors) {
          setSubjectErrors(serverErrors);
        } else {
          setToast({
            variant: "danger",
            message: err.response?.data?.message || "Failed to save subject.",
          });
        }
        return;
      }

      try {
        await Promise.all([
          ...subSubjectRows.map((row) => {
            const payload = { subject_name: row.subject_name, syllabus: row.syllabus };
            return row.id
              ? API.put(`/subjects/${row.id}`, payload)
              : API.post("/subjects", { ...payload, parent_id: subjectId });
          }),
          ...removedSubSubjectIds.map((id) => API.delete(`/subjects/${id}`)),
        ]);
      } catch (err) {
        setToast({
          variant: "danger",
          message:
            err.response?.data?.errors?.subject_name ||
            err.response?.data?.message ||
            "Failed to save one of the sub-subjects.",
        });
        return;
      }

      closeSubjectModal();
      await fetchSubjects();
      setToast({
        variant: "success",
        message: "Subject saved successfully",
      });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to save subject.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = (id) => {
    setPendingDeleteId(id);
    Modal.getOrCreateInstance(deleteModalRef.current).show();
  };

  const handleDelete = async () => {
    try {
      await API.delete(`/subjects/${pendingDeleteId}`);
      Modal.getOrCreateInstance(deleteModalRef.current).hide();
      await fetchSubjects();
      setToast({ variant: "success", message: "Subject removed successfully" });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to delete subject.",
      });
    }
  };

  const openViewModal = (subject) => {
    setViewSubject(subject);
    Modal.getOrCreateInstance(viewModalRef.current).show();
  };

  const exportToExcel = () => {
    const data = filteredSubjects.map((s) => ({
      "Subject Name": s.subject_name,
      Description: s.description || "",
      "Sub-Subjects": (s.SubSubjects || [])
        .map((sub) => sub.subject_name)
        .join(", "),
      Syllabus:
        (s.SubSubjects || []).length === 0
          ? s.syllabus || ""
          : (s.SubSubjects || [])
              .map((sub) => `${sub.subject_name}: ${sub.syllabus || ""}`)
              .join(" | "),
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Subjects");
    XLSX.writeFile(workbook, "subjects.xlsx");
  };

  const exportToPDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    const head = [["Subject Name", "Description", "Sub-Subjects", "Syllabus"]];
    const body = filteredSubjects.map((s) => [
      s.subject_name,
      s.description || "-",
      (s.SubSubjects || []).map((sub) => sub.subject_name).join(", ") ||
        "-",
      (s.SubSubjects || []).length === 0
        ? s.syllabus || "-"
        : (s.SubSubjects || [])
            .map((sub) => `${sub.subject_name}: ${sub.syllabus || ""}`)
            .join(" | "),
    ]);
    autoTable(doc, {
      head,
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [29, 78, 216] },
    });
    doc.save("subjects.pdf");
  };

  if (loading)
    return (
      <div className="text-center p-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  if (error) return <p className="text-center text-danger p-4">{error}</p>;

  return (
    <div className="container-fluid" style={{ maxWidth: "1100px" }}>
      {toast && (
        <div
          className="toast-container position-fixed top-0 end-0 p-3"
          style={{ zIndex: 1080 }}
        >
          <div className={`toast show text-white bg-${toast.variant}`}>
            <div className="d-flex">
              <div className="toast-body">{toast.message}</div>
              <button
                type="button"
                className="btn-close btn-close-white me-2 m-auto"
                onClick={() => setToast(null)}
              ></button>
            </div>
          </div>
        </div>
      )}

      <div className="row g-3 mb-4">
        <div className="col-6 col-md-3">
          <div className="card shadow-sm h-100">
            <div className="card-body text-center">
              <div className="text-muted small text-uppercase fw-bold">
                Total Subjects
              </div>
              <div className="fs-3 fw-bold text-primary">
                {subjects.length}
              </div>
            </div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card shadow-sm h-100">
            <div className="card-body text-center">
              <div className="text-muted small text-uppercase fw-bold">
                Total Sub-Subjects
              </div>
              <div className="fs-3 fw-bold text-info">{totalSubSubjects}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card shadow-sm">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
            <h4 className="mb-0">Subject Management</h4>
            <div className="d-flex gap-2 flex-wrap">
              <Link to="/subjects/inactive" className="btn btn-outline-danger btn-sm">
                <i className="bi bi-x-circle me-1"></i> Inactive Records
              </Link>
              <button
                type="button"
                className="btn btn-outline-success btn-sm"
                onClick={exportToExcel}
              >
                <i className="bi bi-file-earmark-excel me-1"></i> Export Excel
              </button>
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                onClick={exportToPDF}
              >
                <i className="bi bi-file-earmark-pdf me-1"></i> Export PDF
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={openAddSubjectModal}
              >
                <i className="bi bi-plus-lg me-1"></i> Add Subject
              </button>
            </div>
          </div>

          <div className="input-group mb-3" style={{ maxWidth: "350px" }}>
            <span className="input-group-text bg-white">
              <i className="bi bi-search"></i>
            </span>
            <input
              type="text"
              className="form-control"
              placeholder="Search any column..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="table-responsive">
            <table className="table table-striped table-hover align-middle">
              <thead className="table-primary">
                <tr>
                  <th>#</th>
                  <th>Subject Name</th>
                  <th>Description</th>
                  <th>Sub-Subjects</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubjects.length === 0 ? (
                  <tr>
                    <td className="text-center text-muted py-4" colSpan={5}>
                      <i className="bi bi-inbox fs-3 d-block mb-2"></i>
                      No subjects found.
                    </td>
                  </tr>
                ) : (
                  paginatedSubjects.map((s, index) => (
                    <tr key={s.id}>
                      <td>{(currentPage - 1) * ROWS_PER_PAGE + index + 1}</td>
                      <td>{s.subject_name}</td>
                      <td>{s.description || "-"}</td>
                      <td>
                        <span className="badge bg-info">
                          {s.SubSubjects?.length || 0}
                        </span>
                      </td>
                      <td className="d-flex gap-2">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          title="View"
                          onClick={() => openViewModal(s)}
                        >
                          <i className="bi bi-eye"></i>
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          title="Edit"
                          onClick={() => openEditSubjectModal(s)}
                        >
                          <i className="bi bi-pencil"></i>
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          title="Delete"
                          onClick={() => confirmDelete(s.id)}
                        >
                          <i className="bi bi-trash"></i>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="d-flex flex-wrap justify-content-between align-items-center mt-3 gap-2">
            <span className="text-muted small">
              Showing{" "}
              {filteredSubjects.length === 0
                ? 0
                : (currentPage - 1) * ROWS_PER_PAGE + 1}
              –
              {Math.min(currentPage * ROWS_PER_PAGE, filteredSubjects.length)}{" "}
              of {filteredSubjects.length} subjects
            </span>

            <nav>
              <ul className="pagination pagination-sm mb-0">
                <li
                  className={`page-item ${currentPage === 1 ? "disabled" : ""}`}
                >
                  <button
                    className="page-link"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  >
                    « Previous
                  </button>
                </li>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                  (page) => (
                    <li
                      key={page}
                      className={`page-item ${currentPage === page ? "active" : ""}`}
                    >
                      <button
                        className="page-link"
                        onClick={() => setCurrentPage(page)}
                      >
                        {page}
                      </button>
                    </li>
                  )
                )}
                <li
                  className={`page-item ${currentPage === totalPages ? "disabled" : ""}`}
                >
                  <button
                    className="page-link"
                    onClick={() =>
                      setCurrentPage((p) => Math.min(totalPages, p + 1))
                    }
                  >
                    Next »
                  </button>
                </li>
              </ul>
            </nav>
          </div>
        </div>
      </div>

      {/* Add/Edit Subject Modal (subject + all sub-subjects together) */}
      <div
        className="modal fade"
        id="subjectModal"
        tabIndex="-1"
        ref={subjectModalRef}
      >
        <div className="modal-dialog modal-lg modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">
                {editingSubjectId ? "Edit Subject" : "Add Subject"}
              </h5>
              <button
                type="button"
                className="btn-close"
                data-bs-dismiss="modal"
              ></button>
            </div>
            <form onSubmit={handleSubjectSubmit}>
              <div
                className="modal-body"
                style={{ maxHeight: "70vh", overflowY: "auto" }}
              >
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label">Subject Name</label>
                    <input
                      type="text"
                      name="subject_name"
                      className={`form-control ${subjectErrors.subject_name ? "is-invalid" : ""}`}
                      value={subjectForm.subject_name}
                      onChange={handleSubjectChange}
                    />
                    {subjectErrors.subject_name && (
                      <div className="invalid-feedback">
                        {subjectErrors.subject_name}
                      </div>
                    )}
                  </div>
                  <div className="col-12">
                    <label className="form-label">Description</label>
                    <textarea
                      name="description"
                      className="form-control"
                      rows={2}
                      value={subjectForm.description}
                      onChange={handleSubjectChange}
                    ></textarea>
                  </div>

                  {subSubjectRows.length === 0 && (
                    <div className="col-12">
                      <label className="form-label">Syllabus</label>
                      <textarea
                        name="syllabus"
                        className="form-control"
                        rows={3}
                        placeholder="Only used if this subject has no sub-subjects"
                        value={subjectForm.syllabus}
                        onChange={handleSubjectChange}
                      ></textarea>
                    </div>
                  )}
                </div>

                <hr className="my-4" />

                <div className="d-flex justify-content-between align-items-center mb-2">
                  <h6 className="mb-0">Sub-Subjects</h6>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary"
                    onClick={addSubSubjectRow}
                  >
                    <i className="bi bi-plus-lg me-1"></i> Add Sub-Subject
                  </button>
                </div>

                {subSubjectRows.length === 0 ? (
                  <p className="text-muted small mb-0">
                    No sub-subjects added. If this subject has no
                    sub-subjects, use the Syllabus field above instead.
                  </p>
                ) : (
                  <div className="d-flex flex-column gap-3">
                    {subSubjectRows.map((row, idx) => (
                      <div key={row.key} className="border rounded p-3 bg-light">
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <span className="fw-semibold small text-muted">
                            Sub-Subject {idx + 1}
                          </span>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => removeSubSubjectRow(row)}
                          >
                            <i className="bi bi-trash"></i>
                          </button>
                        </div>
                        <div className="row g-2">
                          <div className="col-md-5">
                            <label className="form-label small">Name</label>
                            <input
                              type="text"
                              className={`form-control ${rowErrors[row.key] ? "is-invalid" : ""}`}
                              value={row.subject_name}
                              onChange={(e) =>
                                handleRowChange(row.key, "subject_name", e.target.value)
                              }
                            />
                            {rowErrors[row.key] && (
                              <div className="invalid-feedback">
                                {rowErrors[row.key]}
                              </div>
                            )}
                          </div>
                          <div className="col-md-7">
                            <label className="form-label small">Syllabus</label>
                            <textarea
                              className="form-control"
                              rows={2}
                              value={row.syllabus}
                              onChange={(e) =>
                                handleRowChange(row.key, "syllabus", e.target.value)
                              }
                            ></textarea>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-bs-dismiss="modal"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting}
                >
                  {submitting ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* View Subject Modal (read-only, full nested details) */}
      <div
        className="modal fade"
        id="viewSubjectModal"
        tabIndex="-1"
        ref={viewModalRef}
      >
        <div className="modal-dialog modal-lg modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Subject Details</h5>
              <button
                type="button"
                className="btn-close"
                data-bs-dismiss="modal"
              ></button>
            </div>
            <div
              className="modal-body"
              style={{ maxHeight: "70vh", overflowY: "auto" }}
            >
              {viewSubject && (
                <>
                  <h5 className="text-primary mb-1">
                    {viewSubject.subject_name}
                  </h5>
                  {viewSubject.description && (
                    <p className="text-muted mb-3">{viewSubject.description}</p>
                  )}

                  {(viewSubject.SubSubjects || []).length === 0 && (
                    <div className="mb-3">
                      <h6 className="text-uppercase small text-muted fw-bold">
                        Used in Courses
                      </h6>
                      {(viewSubject.Courses || []).length === 0 ? (
                        <p className="mb-0 text-muted small">
                          Not mapped to any course yet.
                        </p>
                      ) : (
                        <div>
                          {viewSubject.Courses.map((c) => (
                            <span
                              key={c.id}
                              className="badge bg-info text-dark me-1"
                            >
                              {c.course_name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {(viewSubject.SubSubjects || []).length === 0 ? (
                    <div>
                      <h6 className="text-uppercase small text-muted fw-bold">
                        Syllabus
                      </h6>
                      <p className="mb-0" style={{ whiteSpace: "pre-wrap" }}>
                        {viewSubject.syllabus || "No syllabus added."}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <h6 className="text-uppercase small text-muted fw-bold mb-2">
                        Sub-Subjects ({viewSubject.SubSubjects.length})
                      </h6>
                      <div className="d-flex flex-column gap-3">
                        {viewSubject.SubSubjects.map((sub, idx) => (
                          <div key={sub.id} className="border rounded p-3">
                            <div className="fw-semibold mb-1">
                              {idx + 1}. {sub.subject_name}
                            </div>
                            <div
                              className="text-muted small mb-2"
                              style={{ whiteSpace: "pre-wrap" }}
                            >
                              {sub.syllabus || "No syllabus added."}
                            </div>
                            <div className="small">
                              <span className="text-muted text-uppercase fw-bold me-2" style={{ fontSize: "0.7rem" }}>
                                Used in Courses:
                              </span>
                              {(sub.Courses || []).length === 0 ? (
                                <span className="text-muted">Not mapped yet.</span>
                              ) : (
                                sub.Courses.map((c) => (
                                  <span
                                    key={c.id}
                                    className="badge bg-info text-dark me-1"
                                  >
                                    {c.course_name}
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                data-bs-dismiss="modal"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <div
        className="modal fade"
        id="subjectDeleteModal"
        tabIndex="-1"
        ref={deleteModalRef}
      >
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Remove Subject</h5>
              <button
                type="button"
                className="btn-close"
                data-bs-dismiss="modal"
              ></button>
            </div>
            <div className="modal-body">
              Are you sure you want to remove this subject? Its sub-subjects
              will remain linked but hidden until restored.
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                data-bs-dismiss="modal"
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDelete}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SubjectManagement;
