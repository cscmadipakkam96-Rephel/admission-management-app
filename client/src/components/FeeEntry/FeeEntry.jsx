import { useEffect, useRef, useState } from "react";
import { Modal } from "bootstrap";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import API from "../../api/api";
import AdmissionReportCard from "../AdmissionReportCard/AdmissionReportCard";
import FeeCharts from "../FeeCharts/FeeCharts";
import ExpenseEntry from "../ExpenseEntry/ExpenseEntry";
import AddFollowUpModal from "../FollowUpManagement/AddFollowUpModal";
import { computeFeeInfo } from "../../utils/feeInfo";

const initialForm = {
  paid_date: "",
  bill_no: "",
  enrol_no: "",
  amount: "",
  payment_mode: "Cash",
  description: "",
};

const EXPORT_COLUMNS = [
  { key: "paid_date", label: "Bill Date" },
  { key: "bill_no", label: "Bill Number" },
  { key: "enrol_no", label: "Enrollment Number" },
  { key: "amount", label: "Amount" },
  { key: "payment_mode", label: "Mode of Payment" },
  { key: "description", label: "Description" },
];

function FeeEntry() {
  const viewModalRef = useRef(null);
  const [admissions, setAdmissions] = useState([]);
  const [entries, setEntries] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState(initialForm);
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("Pending");
  const [feeStatusSearchTerm, setFeeStatusSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [viewEntry, setViewEntry] = useState(null);
  const [noAdmissionSearchTerm, setNoAdmissionSearchTerm] = useState("");
  const [sortField, setSortField] = useState("paid_date");
  const [sortOrder, setSortOrder] = useState("desc");
  const [chartRange, setChartRange] = useState({ startDate: "", endDate: "" });
  const [followUpPreselect, setFollowUpPreselect] = useState(null);
  const [followUpDefaults, setFollowUpDefaults] = useState({ type: "Fee", reason: "", note: "" });
  const ROWS_PER_PAGE = 10;

  const fetchData = async () => {
    try {
      const [admissionsRes, entriesRes, coursesRes] = await Promise.all([
        API.get("/admissions?active=true"),
        API.get("/fee-entries"),
        API.get("/courses?active=true"),
      ]);
      setAdmissions(admissionsRes.data.data);
      setEntries(entriesRes.data.data);
      setCourses(coursesRes.data.data);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load fee data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [sortField, sortOrder]);

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
    const modalEl = viewModalRef.current;
    if (!modalEl) return;
    modalEl.addEventListener("hidden.bs.modal", forceCleanup);
    return () => modalEl.removeEventListener("hidden.bs.modal", forceCleanup);
  }, [loading]);

  const filteredAdmissions = admissions
    .filter((a) => computeFeeInfo(a, entries, courses).status === statusFilter)
    .filter((a) => {
      if (!feeStatusSearchTerm.trim()) return true;
      const term = feeStatusSearchTerm.trim().toLowerCase();
      const info = computeFeeInfo(a, entries, courses);
      return (
        (a.applicant_name || "").toLowerCase().includes(term) ||
        (a.comn_enrol_no || "").toLowerCase().includes(term) ||
        String(info.totalFee ?? "").includes(term) ||
        String(info.totalPaid ?? "").includes(term) ||
        String(info.balance ?? "").includes(term) ||
        (info.status || "").toLowerCase().includes(term)
      );
    });

  const admissionEnrolNos = new Set(
    admissions.map((a) => a.comn_enrol_no).filter(Boolean)
  );
  const noAdmissionEntries = entries.filter(
    (e) => e.enrol_no && !admissionEnrolNos.has(e.enrol_no)
  );
  const noAdmissionCount = new Set(
    noAdmissionEntries.map((e) => e.enrol_no)
  ).size;
  const filteredNoAdmissionEntries = noAdmissionEntries.filter((e) => {
    if (!noAdmissionSearchTerm.trim()) return true;
    const term = noAdmissionSearchTerm.trim().toLowerCase();
    return (
      (e.enrol_no || "").toLowerCase().includes(term) ||
      (e.bill_no || "").toLowerCase().includes(term) ||
      (e.description || "").toLowerCase().includes(term)
    );
  });

  const openViewModal = (entry) => {
    setViewEntry(entry);
    Modal.getOrCreateInstance(viewModalRef.current).show();
  };

  const openFollowUp = (admission, info) => {
    setFollowUpPreselect({ type: "admission", record: admission });
    setFollowUpDefaults({
      type: "Fee",
      reason: `${info.status} fee balance`,
      note:
        info.balance != null
          ? `Balance: Rs. ${info.balance}. Call regarding pending payment.`
          : "Call regarding pending payment.",
    });
    Modal.getOrCreateInstance(document.getElementById("addFollowUpModal")).show();
  };

  const enrolNoTrimmed = formData.enrol_no.trim();
  const billNoTrimmed = formData.bill_no.trim();

  const billMatchedEnrolNo =
    !enrolNoTrimmed && billNoTrimmed
      ? entries.find((e) => e.bill_no === billNoTrimmed)?.enrol_no || ""
      : "";
  const effectiveEnrolNo = enrolNoTrimmed || billMatchedEnrolNo;

  const matchedPerson = effectiveEnrolNo
    ? admissions.find((a) => a.comn_enrol_no === effectiveEnrolNo)
    : null;
  const matchedFeeInfo = matchedPerson
    ? computeFeeInfo(matchedPerson, entries, courses)
    : null;
  const matchedPersonEntries = matchedPerson
    ? entries
        .filter((e) => e.enrol_no === matchedPerson.comn_enrol_no)
        .sort((a, b) => (a.paid_date || "").localeCompare(b.paid_date || ""))
    : [];

  const relatedEntries =
    !matchedPerson && (enrolNoTrimmed || billNoTrimmed)
      ? entries.filter((e) => {
          const matchesEnrol = enrolNoTrimmed && e.enrol_no === enrolNoTrimmed;
          const matchesBill = billNoTrimmed && e.bill_no === billNoTrimmed;
          return matchesEnrol || matchesBill;
        })
      : [];
  const relatedEntriesTotalPaid = relatedEntries.reduce(
    (sum, e) => sum + (Number(e.amount) || 0),
    0
  );

  const sortedEntries = [...entries].sort((a, b) => {
    const valA = a[sortField] ?? "";
    const valB = b[sortField] ?? "";
    let result;
    if (sortField === "amount") {
      result = (Number(valA) || 0) - (Number(valB) || 0);
    } else if (sortField === "paid_date") {
      result = new Date(valA || 0) - new Date(valB || 0);
    } else {
      result = valA.toString().localeCompare(valB.toString());
    }
    return sortOrder === "asc" ? result : -result;
  });

  const totalPages = Math.max(1, Math.ceil(sortedEntries.length / ROWS_PER_PAGE));
  const paginatedEntries = sortedEntries.slice(
    (currentPage - 1) * ROWS_PER_PAGE,
    currentPage * ROWS_PER_PAGE
  );

  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const sortIcon = (field) => {
    if (sortField !== field) return "bi-arrow-down-up text-muted";
    return sortOrder === "asc" ? "bi-sort-up" : "bi-sort-down";
  };

  const startEdit = (entry) => {
    setEditingId(entry.id);
    setFormData({
      paid_date: entry.paid_date || "",
      bill_no: entry.bill_no || "",
      enrol_no: entry.enrol_no || "",
      amount: entry.amount || "",
      payment_mode: entry.payment_mode || "Cash",
      description: entry.description || "",
    });
    setFormErrors({});
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFormData(initialForm);
    setFormErrors({});
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setFormErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const validate = () => {
    const errors = {};
    if (!formData.amount) errors.amount = "Amount is required.";
    else if (Number(formData.amount) <= 0)
      errors.amount = "Amount must be greater than 0.";
    else if (matchedFeeInfo?.balance !== null && matchedFeeInfo?.balance !== undefined) {
      const editingOriginalAmount = editingId
        ? Number(entries.find((e) => e.id === editingId)?.amount || 0)
        : 0;
      const editableBalance = matchedFeeInfo.balance + editingOriginalAmount;
      if (Number(formData.amount) > editableBalance) {
        errors.amount = `Amount exceeds remaining balance of Rs. ${editableBalance}.`;
      }
    }
    if (!formData.paid_date) errors.paid_date = "Bill date is required.";
    if (!formData.enrol_no.trim())
      errors.enrol_no = "Enrollment Number is required.";
    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});

    setSubmitting(true);
    try {
      const response = editingId
        ? await API.put(`/fee-entries/${editingId}`, formData)
        : await API.post("/fee-entries", formData);
      setFormData(initialForm);
      setEditingId(null);
      await fetchData();
      setToast({
        variant: "success",
        message: response.data.message || "Fee entry saved successfully",
      });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to save fee entry.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const deleteEntry = async (id) => {
    if (!window.confirm("Are you sure you want to delete this fee entry?")) {
      return;
    }
    try {
      const response = await API.delete(`/fee-entries/${id}`);
      await fetchData();
      setToast({
        variant: "success",
        message: response.data.message || "Fee entry deleted successfully",
      });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to delete fee entry.",
      });
    }
  };

  const exportToExcel = () => {
    const data = sortedEntries.map((row) => {
      const record = {};
      EXPORT_COLUMNS.forEach((col) => {
        record[col.label] = row[col.key] ?? "";
      });
      return record;
    });
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Fee Entries");
    XLSX.writeFile(workbook, "fee_entries.xlsx");
  };

  const exportToPDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    const head = [EXPORT_COLUMNS.map((col) => col.label)];
    const body = sortedEntries.map((row) =>
      EXPORT_COLUMNS.map((col) => (row[col.key] ?? "-").toString())
    );
    autoTable(doc, {
      head,
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [29, 78, 216] },
    });
    doc.save("fee_entries.pdf");
  };

  if (loading) return <p className="text-center text-muted p-4">Loading...</p>;
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

      <AdmissionReportCard
        admissions={admissions}
        feeEntries={entries}
        courses={courses}
        onRangeChange={setChartRange}
      />

      <div className="card shadow-sm mb-4">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
            <h4 className="mb-0">Fee Entry</h4>
            <div className="d-flex gap-2">
              <button
                type="button"
                className="btn btn-outline-success btn-sm d-flex align-items-center gap-1"
                onClick={exportToExcel}
              >
                <i className="bi bi-file-earmark-excel"></i> Export Excel
              </button>
              <button
                type="button"
                className="btn btn-outline-danger btn-sm d-flex align-items-center gap-1"
                onClick={exportToPDF}
              >
                <i className="bi bi-file-earmark-pdf"></i> Export PDF
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="row g-3 align-items-end">
            {editingId && (
              <div className="col-12">
                <div className="alert alert-warning py-2 px-3 mb-0 small">
                  Editing existing fee entry. Click Cancel to add a new entry
                  instead.
                </div>
              </div>
            )}
            <div className="col-md-2">
              <label className="form-label">Bill Date</label>
              <input
                type="date"
                name="paid_date"
                className={`form-control ${formErrors.paid_date ? "is-invalid" : ""}`}
                value={formData.paid_date}
                onChange={handleChange}
              />
              {formErrors.paid_date && (
                <div className="invalid-feedback">{formErrors.paid_date}</div>
              )}
            </div>
            <div className="col-md-3">
              <label className="form-label">Bill Number</label>
              <input
                type="text"
                name="bill_no"
                className="form-control"
                value={formData.bill_no}
                onChange={handleChange}
              />
            </div>
            <div className="col-md-3">
              <label className="form-label">Enrollment Number</label>
              <input
                type="text"
                name="enrol_no"
                className={`form-control ${formErrors.enrol_no ? "is-invalid" : ""}`}
                value={formData.enrol_no}
                onChange={handleChange}
              />
              {formErrors.enrol_no && (
                <div className="invalid-feedback">{formErrors.enrol_no}</div>
              )}
            </div>

            {matchedPerson && (
              <div className="col-12">
                <div className="border rounded p-2 px-3 bg-light d-flex flex-wrap gap-4 align-items-center">
                  <div>
                    <span className="text-muted small d-block">Name</span>
                    <strong>{matchedPerson.applicant_name}</strong>
                  </div>
                  <div>
                    <span className="text-muted small d-block">Total Fee</span>
                    <strong
                      className={
                        matchedFeeInfo.isFallbackFee ? "text-primary" : ""
                      }
                      title={
                        matchedFeeInfo.isFallbackFee
                          ? "Not set in Admission — using this course's fee from Course Management"
                          : ""
                      }
                    >
                      {matchedFeeInfo.totalFee !== null
                        ? `Rs. ${matchedFeeInfo.totalFee}`
                        : "Not set"}
                      {matchedFeeInfo.isFallbackFee && (
                        <i className="bi bi-info-circle ms-1 small"></i>
                      )}
                    </strong>
                  </div>
                  <div>
                    <span className="text-muted small d-block">Paid</span>
                    <strong className="text-success">
                      Rs. {matchedFeeInfo.totalPaid}
                    </strong>
                  </div>
                  <div>
                    <span className="text-muted small d-block">Balance</span>
                    <strong className="text-danger">
                      {matchedFeeInfo.balance !== null
                        ? `Rs. ${Math.max(matchedFeeInfo.balance, 0)}`
                        : "-"}
                    </strong>
                  </div>
                  <div>
                    <span className="text-muted small d-block">Status</span>
                    <span
                      className={`badge ${matchedFeeInfo.status === "Paid" ? "bg-success" : "bg-warning"}`}
                    >
                      {matchedFeeInfo.status}
                    </span>
                  </div>
                </div>
                {matchedPersonEntries.length > 0 && (
                  <div className="border rounded-bottom border-top-0 p-2 px-3 bg-white">
                    <div className="text-muted small fw-bold mb-1">
                      Payment History ({matchedPersonEntries.length})
                    </div>
                    <table className="table table-sm mb-0">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Amount</th>
                          <th>Mode</th>
                          <th>Bill No</th>
                          <th>Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matchedPersonEntries.map((e) => (
                          <tr key={e.id}>
                            <td>{e.paid_date || "-"}</td>
                            <td>Rs. {e.amount}</td>
                            <td>{e.payment_mode || "-"}</td>
                            <td>{e.bill_no || "-"}</td>
                            <td>{e.description || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {!matchedPerson && relatedEntries.length > 0 && (
              <div className="col-12">
                <div className="border rounded p-2 px-3 bg-light">
                  <div className="text-warning small fw-bold mb-2">
                    <i className="bi bi-exclamation-triangle me-1"></i>
                    No Admission entry found for this Enrolment/Bill Number —
                    but fee payment(s) already exist:
                  </div>
                  <div className="d-flex flex-wrap gap-4 align-items-center mb-2">
                    <div>
                      <span className="text-muted small d-block">
                        Total Paid So Far
                      </span>
                      <strong className="text-success">
                        Rs. {relatedEntriesTotalPaid}
                      </strong>
                    </div>
                    <div>
                      <span className="text-muted small d-block">
                        Entries Found
                      </span>
                      <strong>{relatedEntries.length}</strong>
                    </div>
                  </div>
                  <table className="table table-sm table-bordered mb-0 bg-white">
                    <thead>
                      <tr>
                        <th>Bill Date</th>
                        <th>Bill No</th>
                        <th>Enrol No</th>
                        <th>Amount</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relatedEntries.map((e) => (
                        <tr key={e.id}>
                          <td>{e.paid_date ?? "-"}</td>
                          <td>{e.bill_no ?? "-"}</td>
                          <td>{e.enrol_no ?? "-"}</td>
                          <td>{e.amount ?? "-"}</td>
                          <td>{e.description || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="col-md-2">
              <label className="form-label">Amount</label>
              <input
                type="number"
                name="amount"
                className={`form-control ${formErrors.amount ? "is-invalid" : ""}`}
                value={formData.amount}
                onChange={handleChange}
              />
              {formErrors.amount && (
                <div className="invalid-feedback">{formErrors.amount}</div>
              )}
            </div>
            <div className="col-md-2">
              <label className="form-label">Mode of Payment</label>
              <select
                name="payment_mode"
                className="form-select"
                value={formData.payment_mode}
                onChange={handleChange}
              >
                <option value="Cash">Cash</option>
                <option value="Cheque">Cheque</option>
                <option value="Card">Card</option>
                <option value="GPay">GPay</option>
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label">Description</label>
              <input
                type="text"
                name="description"
                className="form-control"
                placeholder="Optional note (e.g. name, if not yet admitted)"
                value={formData.description}
                onChange={handleChange}
              />
            </div>

            <div className="col-md-2 d-flex gap-2">
              <button
                type="submit"
                className="btn btn-primary flex-fill"
                disabled={submitting}
              >
                {submitting ? "Saving..." : editingId ? "Update" : "Save"}
              </button>
              {editingId && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={cancelEdit}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          <h6 className="mt-4 mb-2">Fee Entries</h6>
          <div className="table-responsive">
            <table className="table table-sm table-striped align-middle">
              <thead className="table-light">
                <tr>
                  <th>#</th>
                  <th role="button" onClick={() => handleSort("paid_date")}>
                    Bill Date{" "}
                    <i className={`bi ${sortIcon("paid_date")}`}></i>
                  </th>
                  <th role="button" onClick={() => handleSort("bill_no")}>
                    Bill Number{" "}
                    <i className={`bi ${sortIcon("bill_no")}`}></i>
                  </th>
                  <th role="button" onClick={() => handleSort("enrol_no")}>
                    Enrollment Number{" "}
                    <i className={`bi ${sortIcon("enrol_no")}`}></i>
                  </th>
                  <th role="button" onClick={() => handleSort("amount")}>
                    Amount <i className={`bi ${sortIcon("amount")}`}></i>
                  </th>
                  <th
                    role="button"
                    onClick={() => handleSort("payment_mode")}
                  >
                    Mode of Payment{" "}
                    <i className={`bi ${sortIcon("payment_mode")}`}></i>
                  </th>
                  <th role="button" onClick={() => handleSort("description")}>
                    Description{" "}
                    <i className={`bi ${sortIcon("description")}`}></i>
                  </th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {paginatedEntries.length === 0 ? (
                  <tr>
                    <td className="text-center text-muted" colSpan={8}>
                      No fee entries found.
                    </td>
                  </tr>
                ) : (
                  paginatedEntries.map((entry, index) => (
                    <tr key={entry.id}>
                      <td>{(currentPage - 1) * ROWS_PER_PAGE + index + 1}</td>
                      <td>{entry.paid_date ?? "-"}</td>
                      <td>{entry.bill_no ?? "-"}</td>
                      <td>{entry.enrol_no ?? "-"}</td>
                      <td>{entry.amount ?? "-"}</td>
                      <td>{entry.payment_mode ?? "-"}</td>
                      <td>{entry.description || "-"}</td>
                      <td className="d-flex gap-2">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          onClick={() => openViewModal(entry)}
                        >
                          <i className="bi bi-eye"></i>
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-warning"
                          onClick={() => startEdit(entry)}
                        >
                          <i className="bi bi-pencil"></i>
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => deleteEntry(entry.id)}
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

          <div className="d-flex flex-wrap justify-content-between align-items-center mt-2 gap-2">
            <span className="text-muted small">
              Showing{" "}
              {entries.length === 0
                ? 0
                : (currentPage - 1) * ROWS_PER_PAGE + 1}
              –{Math.min(currentPage * ROWS_PER_PAGE, entries.length)} of{" "}
              {entries.length} records
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

      <div className="card shadow-sm">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
            <h5 className="mb-0">All Students — Fee Status</h5>
            <div className="d-flex gap-2">
              <button
                type="button"
                className={`btn btn-sm ${statusFilter === "Paid" ? "btn-success" : "btn-outline-success"}`}
                onClick={() => setStatusFilter("Paid")}
              >
                Paid
              </button>
              <button
                type="button"
                className={`btn btn-sm ${statusFilter === "Pending" ? "btn-warning" : "btn-outline-warning"}`}
                onClick={() => setStatusFilter("Pending")}
              >
                Pending
              </button>
              <button
                type="button"
                className={`btn btn-sm ${statusFilter === "NoAdmission" ? "btn-secondary" : "btn-outline-secondary"}`}
                onClick={() => setStatusFilter("NoAdmission")}
              >
                Paid but Not in Admission
                {noAdmissionCount > 0 && (
                  <span className="badge bg-danger ms-1">
                    {noAdmissionCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {statusFilter === "NoAdmission" ? (
            <div className="table-responsive">
              <div className="alert alert-info small">
                These Enrolment Numbers have fee paid, but there is no
                Admission entry for them yet in the Admission List. Once you
                add their Admission entry, it will automatically move to the
                Paid section.
              </div>
              <div className="input-group input-group-sm mb-2" style={{ maxWidth: "320px" }}>
                <span className="input-group-text bg-white">
                  <i className="bi bi-search"></i>
                </span>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Filter by Enrolment No, Bill No, or Description..."
                  value={noAdmissionSearchTerm}
                  onChange={(e) => setNoAdmissionSearchTerm(e.target.value)}
                />
              </div>
              <table className="table table-striped table-hover align-middle">
                <thead className="table-primary">
                  <tr>
                    <th>#</th>
                    <th>Bill Date</th>
                    <th>Bill Number</th>
                    <th>Enrolment No</th>
                    <th>Amount</th>
                    <th>Mode of Payment</th>
                    <th>Description</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredNoAdmissionEntries.length === 0 ? (
                    <tr>
                      <td className="text-center text-muted" colSpan={8}>
                        No fee entries without a matching admission found.
                      </td>
                    </tr>
                  ) : (
                    filteredNoAdmissionEntries.map((entry, index) => (
                      <tr key={entry.id}>
                        <td>{index + 1}</td>
                        <td>{entry.paid_date ?? "-"}</td>
                        <td>{entry.bill_no ?? "-"}</td>
                        <td>{entry.enrol_no ?? "-"}</td>
                        <td>{entry.amount ?? "-"}</td>
                        <td>{entry.payment_mode ?? "-"}</td>
                        <td>{entry.description || "-"}</td>
                        <td className="d-flex gap-2">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            onClick={() => openViewModal(entry)}
                          >
                            <i className="bi bi-eye"></i>
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-warning"
                            onClick={() => startEdit(entry)}
                          >
                            <i className="bi bi-pencil"></i>
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => deleteEntry(entry.id)}
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
          ) : (
            <div className="table-responsive">
              <div
                className="input-group input-group-sm mb-2"
                style={{ maxWidth: "320px" }}
              >
                <span className="input-group-text bg-white">
                  <i className="bi bi-search"></i>
                </span>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Search any column..."
                  value={feeStatusSearchTerm}
                  onChange={(e) => setFeeStatusSearchTerm(e.target.value)}
                />
              </div>
              <table className="table table-striped table-hover align-middle">
                <thead className="table-primary">
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>Enrolment No</th>
                    <th>Total Fee</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Status</th>
                    {statusFilter === "Pending" && <th>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredAdmissions.length === 0 ? (
                    <tr>
                      <td
                        className="text-center text-muted"
                        colSpan={statusFilter === "Pending" ? 8 : 7}
                      >
                        No {statusFilter.toLowerCase()} records found.
                      </td>
                    </tr>
                  ) : (
                    filteredAdmissions.map((a, index) => {
                      const info = computeFeeInfo(a, entries, courses);
                      return (
                        <tr key={a.id}>
                          <td>{index + 1}</td>
                          <td>{a.applicant_name}</td>
                          <td>{a.comn_enrol_no || "-"}</td>
                          <td>
                            {info.totalFee !== null ? (
                              <span
                                className={
                                  info.isFallbackFee
                                    ? "text-primary fw-semibold"
                                    : ""
                                }
                                title={
                                  info.isFallbackFee
                                    ? "Not set in Admission — using this course's fee from Course Management"
                                    : ""
                                }
                              >
                                Rs. {info.totalFee}
                                {info.isFallbackFee && (
                                  <i
                                    className="bi bi-info-circle ms-1"
                                    style={{ fontSize: "0.75em" }}
                                  ></i>
                                )}
                              </span>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td>Rs. {info.totalPaid}</td>
                          <td>
                            {info.balance !== null
                              ? `Rs. ${Math.max(info.balance, 0)}`
                              : "-"}
                          </td>
                          <td>
                            <span
                              className={`badge ${info.status === "Paid" ? "bg-success" : "bg-warning"}`}
                            >
                              {info.status}
                            </span>
                          </td>
                          {statusFilter === "Pending" && (
                            <td>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-warning"
                                title="Follow Up"
                                onClick={() => openFollowUp(a, info)}
                              >
                                <i className="bi bi-telephone-outbound"></i>
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <FeeCharts
        admissions={admissions}
        entries={entries}
        courses={courses}
        startDate={chartRange.startDate}
        endDate={chartRange.endDate}
      />

      <ExpenseEntry />

      <AddFollowUpModal
        preselected={followUpPreselect}
        defaultType={followUpDefaults.type}
        defaultReason={followUpDefaults.reason}
        defaultNote={followUpDefaults.note}
        onSaved={() =>
          setToast({ variant: "success", message: "Follow-up created successfully" })
        }
      />

      {/* View Fee Entry Modal */}
      <div
        className="modal fade"
        id="feeEntryViewModal"
        tabIndex="-1"
        ref={viewModalRef}
      >
        <div className="modal-dialog modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Fee Entry Details</h5>
              <button
                type="button"
                className="btn-close"
                data-bs-dismiss="modal"
              ></button>
            </div>
            <div className="modal-body">
              {viewEntry && (
                <div className="row g-3">
                  {EXPORT_COLUMNS.map((col) => (
                    <div className="col-md-6" key={col.key}>
                      <div className="text-muted small fw-bold text-uppercase">
                        {col.label}
                      </div>
                      <div>{viewEntry[col.key] || "-"}</div>
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
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FeeEntry;
