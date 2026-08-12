import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "bootstrap";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import API from "../../api/api";
import AddFollowUpModal, { FOLLOW_UP_TYPES } from "./AddFollowUpModal";
import ViewFollowUpModal from "./ViewFollowUpModal";

const BUCKETS = [
  { key: "overdue", label: "Overdue", emoji: "🔴", cardClass: "text-bg-danger", badgeClass: "text-bg-danger" },
  { key: "due_today", label: "Due Today", emoji: "🟠", cardClass: "text-bg-warning", badgeClass: "text-bg-warning" },
  { key: "upcoming", label: "Upcoming", emoji: "🔵", cardClass: "text-bg-info", badgeClass: "text-bg-info" },
  { key: "completed", label: "Completed", emoji: "🟢", cardClass: "text-bg-success", badgeClass: "text-bg-success" },
];
const BUCKET_BY_KEY = Object.fromEntries(BUCKETS.map((b) => [b.key, b]));

const FOLLOWUP_EXPORT_COLUMNS = [
  { key: "person_name", label: "Student / Lead" },
  { key: "enrol_no", label: "Enrolment No" },
  { key: "phone", label: "Phone" },
  { key: "follow_up_type", label: "Type" },
  { key: "reason", label: "Reason" },
  { key: "note", label: "Note" },
  { key: "due_date", label: "Due Date" },
  { key: "status", label: "Status" },
  { key: "completed_at", label: "Completed Date" },
];

const personOf = (f) => (f.admission_id ? f.Admission : f.InformationSheet);
const personName = (f) => {
  const p = personOf(f);
  if (!p) return "-";
  return `${p.initial ? p.initial + " " : ""}${p.applicant_name || "-"}`;
};
const personPhone = (f) => {
  const p = personOf(f);
  return p?.mobile_no || p?.telephone_no || "-";
};

const ROWS_PER_PAGE = 10;

function FollowUpManagement() {
  const navigate = useNavigate();
  const [followUps, setFollowUps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);

  const [bucketFilter, setBucketFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [dueDateFilter, setDueDateFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [editingRecord, setEditingRecord] = useState(null);
  const [viewFollowUp, setViewFollowUp] = useState(null);

  const fetchFollowUps = async () => {
    try {
      const response = await API.get("/follow-ups");
      setFollowUps(response.data.data);
      setError("");
    } catch {
      setError("Unable to load follow-up data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFollowUps();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [bucketFilter, typeFilter, dueDateFilter, searchTerm]);

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
    const addEl = document.getElementById("addFollowUpModal");
    const viewEl = document.getElementById("viewFollowUpModal");
    if (!addEl || !viewEl) return;
    [addEl, viewEl].forEach((el) => el.addEventListener("hidden.bs.modal", forceCleanup));
    return () => {
      [addEl, viewEl].forEach((el) => el.removeEventListener("hidden.bs.modal", forceCleanup));
    };
  }, [loading]);

  const counts = useMemo(() => {
    const c = { overdue: 0, due_today: 0, upcoming: 0, completed: 0 };
    followUps.forEach((f) => {
      if (c[f.bucket] !== undefined) c[f.bucket]++;
    });
    return c;
  }, [followUps]);
  const totalOpen = counts.overdue + counts.due_today + counts.upcoming;

  const hasActiveFilters = bucketFilter || typeFilter || dueDateFilter || searchTerm;
  const clearFilters = () => {
    setBucketFilter("");
    setTypeFilter("");
    setDueDateFilter("");
    setSearchTerm("");
  };

  const filteredFollowUps = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return followUps.filter((f) => {
      if (bucketFilter && f.bucket !== bucketFilter) return false;
      if (typeFilter && f.follow_up_type !== typeFilter) return false;
      if (dueDateFilter && f.due_date !== dueDateFilter) return false;
      if (term) {
        const p = personOf(f);
        const matches =
          (p?.applicant_name || "").toLowerCase().includes(term) ||
          (p?.comn_enrol_no || "").toLowerCase().includes(term) ||
          (p?.mobile_no || "").toLowerCase().includes(term) ||
          (p?.telephone_no || "").toLowerCase().includes(term);
        if (!matches) return false;
      }
      return true;
    });
  }, [followUps, bucketFilter, typeFilter, dueDateFilter, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredFollowUps.length / ROWS_PER_PAGE));
  const paginatedFollowUps = filteredFollowUps.slice(
    (currentPage - 1) * ROWS_PER_PAGE,
    currentPage * ROWS_PER_PAGE
  );

  const openAddModal = () => {
    setEditingRecord(null);
    Modal.getOrCreateInstance(document.getElementById("addFollowUpModal")).show();
  };

  const openEditModal = (followUp) => {
    setEditingRecord(followUp);
    Modal.getOrCreateInstance(document.getElementById("viewFollowUpModal")).hide();
    Modal.getOrCreateInstance(document.getElementById("addFollowUpModal")).show();
  };

  const openViewModal = (followUp) => {
    setViewFollowUp(followUp);
    Modal.getOrCreateInstance(document.getElementById("viewFollowUpModal")).show();
  };

  const handleSaved = (message) => {
    fetchFollowUps();
    setToast({ variant: "success", message: message || "Follow-up saved successfully" });
  };

  const markCompleted = async (id) => {
    try {
      const response = await API.put(`/follow-ups/${id}`, { status: "Completed" });
      Modal.getOrCreateInstance(document.getElementById("viewFollowUpModal")).hide();
      await fetchFollowUps();
      setToast({ variant: "success", message: response.data.message || "Follow-up marked completed" });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to update follow-up.",
      });
    }
  };

  const deleteFollowUp = async (id) => {
    if (!window.confirm("Remove this follow-up? It can be restored later if needed.")) return;
    try {
      await API.delete(`/follow-ups/${id}`);
      Modal.getOrCreateInstance(document.getElementById("viewFollowUpModal")).hide();
      await fetchFollowUps();
      setToast({ variant: "success", message: "Follow-up removed successfully" });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to remove follow-up.",
      });
    }
  };

  const openStudent360 = (admissionId) => {
    navigate("/student-tracking", { state: { openStudentId: admissionId } });
  };
  const openInformationSheet = (sheetId) => {
    navigate("/information-sheet", { state: { openSheetId: sheetId } });
  };

  const exportRows = () =>
    filteredFollowUps.map((f) => ({
      person_name: personName(f),
      enrol_no: f.admission_id ? personOf(f)?.comn_enrol_no || "-" : "-",
      phone: personPhone(f),
      follow_up_type: f.follow_up_type,
      reason: f.reason || "-",
      note: f.note || "-",
      due_date: f.due_date || "-",
      status: f.status,
      completed_at: f.completed_at ? f.completed_at.slice(0, 10) : "-",
    }));

  const exportToExcel = () => {
    const data = exportRows().map((row) => {
      const record = {};
      FOLLOWUP_EXPORT_COLUMNS.forEach((col) => {
        record[col.label] = row[col.key] ?? "";
      });
      return record;
    });
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Follow-Ups");
    XLSX.writeFile(workbook, "follow_ups.xlsx");
  };

  const exportToPDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    const head = [FOLLOWUP_EXPORT_COLUMNS.map((col) => col.label)];
    const body = exportRows().map((row) =>
      FOLLOWUP_EXPORT_COLUMNS.map((col) => (row[col.key] ?? "-").toString())
    );
    doc.setFontSize(14);
    doc.text("Follow-Up Management Report", 10, 12);
    autoTable(doc, {
      head,
      body,
      startY: 18,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [13, 110, 253] },
    });
    doc.save("follow_ups.pdf");
  };

  if (loading) return <p className="text-center text-muted p-4">Loading follow-ups...</p>;

  return (
    <div className="card shadow-sm mt-4">
      <div className="card-body">
        {toast && (
          <div className="toast-container position-fixed top-0 end-0 p-3" style={{ zIndex: 1080 }}>
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

        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <h3 className="mb-0">
            <i className="bi bi-telephone-outbound me-2 text-primary"></i>Follow-Up Management
          </h3>
          <div className="d-flex gap-2 flex-wrap">
            <button type="button" className="btn btn-outline-success btn-sm" onClick={exportToExcel}>
              <i className="bi bi-file-earmark-excel me-1"></i> Export Excel
            </button>
            <button type="button" className="btn btn-outline-danger btn-sm" onClick={exportToPDF}>
              <i className="bi bi-file-earmark-pdf me-1"></i> Export PDF
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => window.print()}
            >
              <i className="bi bi-printer me-1"></i> Print
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={openAddModal}>
              <i className="bi bi-plus-lg me-1"></i> Add Follow-Up
            </button>
          </div>
        </div>

        {error && <div className="alert alert-danger py-2">{error}</div>}

        <div className="row g-2 mb-3">
          <div className="col-6 col-md-2">
            <div
              role="button"
              className={`border rounded-3 p-3 text-center h-100 ${!bucketFilter ? "border-primary border-2" : ""}`}
              onClick={() => setBucketFilter("")}
            >
              <div className="fs-4 fw-bold">{totalOpen}</div>
              <div className="text-muted small">📌 Total Open</div>
            </div>
          </div>
          {BUCKETS.map((b) => (
            <div className="col-6 col-md-2" key={b.key}>
              <div
                role="button"
                className={`rounded-3 p-3 text-center h-100 ${b.cardClass} ${bucketFilter === b.key ? "border border-3 border-dark" : ""}`}
                onClick={() => setBucketFilter((prev) => (prev === b.key ? "" : b.key))}
              >
                <div className="fs-4 fw-bold">{counts[b.key]}</div>
                <div className="small">
                  {b.emoji} {b.label}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="row g-2 mb-3 align-items-end">
          <div className="col-md-3">
            <label className="form-label small mb-1">Search</label>
            <div className="input-group">
              <span className="input-group-text bg-white">
                <i className="bi bi-search"></i>
              </span>
              <input
                type="text"
                className="form-control"
                placeholder="Name, Enrolment No, or Phone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small mb-1">Status</label>
            <select
              className="form-select"
              value={bucketFilter}
              onChange={(e) => setBucketFilter(e.target.value)}
            >
              <option value="">All</option>
              {BUCKETS.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.emoji} {b.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small mb-1">Follow-Up Type</label>
            <select
              className="form-select"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="">All Types</option>
              {FOLLOW_UP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small mb-1">Due Date</label>
            <input
              type="date"
              className="form-control"
              value={dueDateFilter}
              onChange={(e) => setDueDateFilter(e.target.value)}
            />
          </div>
          <div className="col-6 col-md-2">
            {hasActiveFilters && (
              <button type="button" className="btn btn-outline-secondary w-100" onClick={clearFilters}>
                <i className="bi bi-x-lg me-1"></i> Clear Filters
              </button>
            )}
          </div>
        </div>

        {filteredFollowUps.length === 0 ? (
          <div className="text-center text-muted py-5">
            <i className="bi bi-inbox fs-3 d-block mb-2"></i>
            {followUps.length === 0
              ? "No follow-ups yet — add one from here, or from Risk Management, Fee Entry, or Information Sheet."
              : "No follow-ups match the current filters."}
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-striped table-hover align-middle">
              <thead className="table-primary">
                <tr>
                  <th>Student / Lead</th>
                  <th>Enrolment No</th>
                  <th>Phone</th>
                  <th>Type</th>
                  <th>Reason</th>
                  <th>Note</th>
                  <th>Due Date</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedFollowUps.map((f) => {
                  const b = BUCKET_BY_KEY[f.bucket];
                  const p = personOf(f);
                  return (
                    <tr key={f.id}>
                      <td>
                        <div className="fw-semibold">{personName(f)}</div>
                        <span className="badge text-bg-light border text-dark">
                          {f.admission_id ? "Student" : "Lead"}
                        </span>
                      </td>
                      <td>{f.admission_id ? p?.comn_enrol_no || "-" : "-"}</td>
                      <td>{personPhone(f)}</td>
                      <td>{f.follow_up_type}</td>
                      <td className="small">{f.reason || "-"}</td>
                      <td className="small" style={{ maxWidth: "220px" }} title={f.note || ""}>
                        {f.note ? (f.note.length > 40 ? `${f.note.slice(0, 40)}...` : f.note) : "-"}
                      </td>
                      <td>{f.due_date}</td>
                      <td>
                        {b && (
                          <span className={`badge ${b.badgeClass}`}>
                            {b.emoji} {b.label}
                          </span>
                        )}
                      </td>
                      <td className="small">{(f.created_at || "").slice(0, 10)}</td>
                      <td className="d-flex gap-2">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          title="View"
                          onClick={() => openViewModal(f)}
                        >
                          <i className="bi bi-eye"></i>
                        </button>
                        {f.status === "Open" && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-success"
                            title="Mark Completed"
                            onClick={() => markCompleted(f.id)}
                          >
                            <i className="bi bi-check-circle"></i>
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          title="Edit"
                          onClick={() => openEditModal(f)}
                        >
                          <i className="bi bi-pencil"></i>
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          title="Delete"
                          onClick={() => deleteFollowUp(f.id)}
                        >
                          <i className="bi bi-trash"></i>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {filteredFollowUps.length > 0 && (
          <div className="d-flex flex-wrap justify-content-between align-items-center mt-3 gap-2">
            <span className="text-muted small">
              Showing {(currentPage - 1) * ROWS_PER_PAGE + 1}–
              {Math.min(currentPage * ROWS_PER_PAGE, filteredFollowUps.length)} of{" "}
              {filteredFollowUps.length} follow-ups
            </span>
            <nav>
              <ul className="pagination pagination-sm mb-0">
                <li className={`page-item ${currentPage === 1 ? "disabled" : ""}`}>
                  <button className="page-link" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>
                    « Previous
                  </button>
                </li>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <li key={page} className={`page-item ${currentPage === page ? "active" : ""}`}>
                    <button className="page-link" onClick={() => setCurrentPage(page)}>
                      {page}
                    </button>
                  </li>
                ))}
                <li className={`page-item ${currentPage === totalPages ? "disabled" : ""}`}>
                  <button
                    className="page-link"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next »
                  </button>
                </li>
              </ul>
            </nav>
          </div>
        )}
      </div>

      <AddFollowUpModal preselected={null} editingRecord={editingRecord} onSaved={handleSaved} />
      <ViewFollowUpModal
        followUp={viewFollowUp}
        onOpenStudent={openStudent360}
        onOpenSheet={openInformationSheet}
        onMarkCompleted={markCompleted}
        onEdit={openEditModal}
        onDelete={deleteFollowUp}
      />
    </div>
  );
}

export default FollowUpManagement;
