import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Modal } from "bootstrap";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import API from "../../api/api";

const initialForm = {
  applicant_name: "",
  father_husband_name: "",
  address: "",
  mobile_no: "",
  email: "",
  sex: "",
  religion: "",
  community: "",
  educational_qualification: "",
  occupation: "",
  pin_code: "",
  qualification_status: "",
  qualification_year: "",
  qualification_subject: "",
  prior_course_institution: "",
  prior_course_subject: "",
  family_income: "",
  study_reason: "",
  course_interested: "",
  preferred_timings: "",
  plan_to_join: "",
  heard_source: [],
  interested_updates: [],
  sheet_date: "",
  enrol_no: "",
  course: "",
  date_of_joining: "",
  counselling_handled_by: "",
  counselling_date: "",
  counselling_time: "",
};

const UPDATE_CHANNELS = ["SMS", "WhatsApp", "Telephone"];

const MOBILE_SEGMENT_LENGTH = 10;

const QUALIFICATION_OPTIONS = [
  "10th & Below",
  "12th",
  "Diploma",
  "UG",
  "PG",
  "Other",
];

const HOURS = Array.from({ length: 12 }, (_, i) =>
  String(i + 1).padStart(2, "0")
);
const MINUTES = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, "0")
);

const parseTime = (value) => {
  const match = /^(\d{2}|--):(\d{2}|--) (AM|PM|--)$/.exec(value || "");
  if (!match) return { hour: "", minute: "", period: "" };
  return {
    hour: match[1] === "--" ? "" : match[1],
    minute: match[2] === "--" ? "" : match[2],
    period: match[3] === "--" ? "" : match[3],
  };
};

const composeTime = (hour, minute, period) => {
  if (!hour && !minute && !period) return "";
  return `${hour || "--"}:${minute || "--"} ${period || "--"}`;
};

const SOURCE_SUB_OPTIONS = {
  Newspaper: ["Hindu", "Dinathanthi", "Dinamalar", "Others"],
  Television: ["Sun TV", "Raj TV", "Vijay TV", "Jaya TV", "Others"],
  Others: [
    "Pamphlet",
    "Banner",
    "Wall Posters",
    "Q&A Books",
    "CSCians",
    "Faculties",
  ],
};

const VIEW_FIELDS = [
  { key: "sheet_date", label: "Date" },
  { key: "applicant_name", label: "Name" },
  { key: "father_husband_name", label: "Father's / Husband's Name" },
  { key: "address", label: "Address" },
  { key: "pin_code", label: "Pin Code" },
  { key: "mobile_no", label: "Mobile / Telephone No" },
  { key: "email", label: "Email" },
  { key: "sex", label: "Sex" },
  { key: "religion", label: "Religion" },
  { key: "community", label: "Community" },
  { key: "educational_qualification", label: "Educational Qualification" },
  { key: "qualification_status", label: "Qualification Status" },
  { key: "qualification_year", label: "Which Year" },
  { key: "qualification_subject", label: "Qualification Subject" },
  { key: "occupation", label: "Occupation" },
  { key: "family_income", label: "Family Income Per Month" },
  { key: "prior_course_institution", label: "Prior Course Institution" },
  { key: "prior_course_subject", label: "Prior Course Subject" },
  { key: "study_reason", label: "Why Study Computer Course" },
  { key: "course_interested", label: "Course Interested to Join" },
  { key: "preferred_timings", label: "Preferred Timings" },
  { key: "effective_plan_to_join", label: "Plan to Join" },
  { key: "heard_source", label: "How Did You Know About Us" },
  { key: "interested_updates", label: "Interested in Updates Via" },
  { key: "enrol_no", label: "E.No" },
  { key: "course", label: "Course" },
  { key: "date_of_joining", label: "DOJ" },
  { key: "counselling_handled_by", label: "Counselling Handled By" },
  { key: "counselling_date", label: "Counselling Date" },
  { key: "counselling_time", label: "Counselling Time" },
];

function InformationSheetEntry() {
  const modalRef = useRef(null);
  const deleteModalRef = useRef(null);
  const viewModalRef = useRef(null);

  const [sheets, setSheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [joinFilter, setJoinFilter] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [viewSheet, setViewSheet] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const ROWS_PER_PAGE = 10;

  const fetchSheets = async () => {
    try {
      const response = await API.get("/information-sheets?active=true");
      setSheets(response.data.data);
      setError("");
    } catch (err) {
      setError(
        err.response?.data?.message || "Failed to load information sheets."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSheets();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, joinFilter]);

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
    const modalEl = modalRef.current;
    const deleteModalEl = deleteModalRef.current;
    const viewModalEl = viewModalRef.current;
    if (!modalEl || !deleteModalEl || !viewModalEl) return;
    [modalEl, deleteModalEl, viewModalEl].forEach((el) =>
      el.addEventListener("hidden.bs.modal", forceCleanup)
    );
    return () => {
      [modalEl, deleteModalEl, viewModalEl].forEach((el) =>
        el.removeEventListener("hidden.bs.modal", forceCleanup)
      );
    };
  }, [loading]);

  const filteredSheets = sheets.filter((s) => {
    if (joinFilter === "joined" && !s.is_joined) return false;
    if (joinFilter === "not_joined" && s.is_joined) return false;
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      (s.applicant_name || "").toLowerCase().includes(term) ||
      (s.mobile_no || "").toLowerCase().includes(term) ||
      (s.course_interested || "").toLowerCase().includes(term) ||
      (s.course || "").toLowerCase().includes(term)
    );
  });

  const editingIsJoined =
    sheets.find((s) => s.id === editingId)?.is_joined || false;

  const totalPages = Math.max(
    1,
    Math.ceil(filteredSheets.length / ROWS_PER_PAGE)
  );
  const paginatedSheets = filteredSheets.slice(
    (currentPage - 1) * ROWS_PER_PAGE,
    currentPage * ROWS_PER_PAGE
  );

  const exportToExcel = () => {
    const data = filteredSheets.map((row) => {
      const record = {};
      VIEW_FIELDS.forEach((col) => {
        record[col.label] = row[col.key] ?? "";
      });
      return record;
    });
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Information Sheets");
    XLSX.writeFile(workbook, "information_sheets.xlsx");
  };

  const exportToPDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    const head = [VIEW_FIELDS.map((col) => col.label)];
    const body = filteredSheets.map((row) =>
      VIEW_FIELDS.map((col) => (row[col.key] ?? "-").toString())
    );
    autoTable(doc, {
      head,
      body,
      styles: { fontSize: 5 },
      headStyles: { fillColor: [29, 78, 216] },
    });
    doc.save("information_sheets.pdf");
  };

  const openAddModal = () => {
    setEditingId(null);
    setFormData(initialForm);
    Modal.getOrCreateInstance(modalRef.current).show();
  };

  const openEditModal = (sheet) => {
    setEditingId(sheet.id);
    setFormData({
      applicant_name: sheet.applicant_name || "",
      father_husband_name: sheet.father_husband_name || "",
      address: sheet.address || "",
      mobile_no: sheet.mobile_no || "",
      email: sheet.email || "",
      sex: sheet.sex || "",
      religion: sheet.religion || "",
      community: sheet.community || "",
      educational_qualification: sheet.educational_qualification || "",
      occupation: sheet.occupation || "",
      pin_code: sheet.pin_code || "",
      qualification_status: sheet.qualification_status || "",
      qualification_year: sheet.qualification_year || "",
      qualification_subject: sheet.qualification_subject || "",
      prior_course_institution: sheet.prior_course_institution || "",
      prior_course_subject: sheet.prior_course_subject || "",
      family_income: sheet.family_income || "",
      study_reason: sheet.study_reason || "",
      course_interested: sheet.course_interested || "",
      preferred_timings: sheet.preferred_timings || "",
      plan_to_join: sheet.plan_to_join || "",
      heard_source: sheet.heard_source
        ? sheet.heard_source.split(",").map((s) => s.trim())
        : [],
      interested_updates: sheet.interested_updates
        ? sheet.interested_updates.split(",").map((s) => s.trim())
        : [],
      sheet_date: sheet.sheet_date || "",
      enrol_no: sheet.enrol_no || "",
      course: sheet.course || "",
      date_of_joining: sheet.date_of_joining || "",
      counselling_handled_by: sheet.counselling_handled_by || "",
      counselling_date: sheet.counselling_date || "",
      counselling_time: sheet.counselling_time || "",
    });
    Modal.getOrCreateInstance(modalRef.current).show();
  };

  const closeModal = () => {
    Modal.getOrCreateInstance(modalRef.current).hide();
  };

  const openViewModal = (sheet) => {
    setViewSheet(sheet);
    Modal.getOrCreateInstance(viewModalRef.current).show();
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    let cleanValue = value;

    if (name === "mobile_no") {
      // Allow digits and a single "/" so both mobile & telephone number can be entered (e.g. 9876543210/5425433)
      let v = value.replace(/[^\d/]/g, "");
      const firstSlash = v.indexOf("/");
      if (firstSlash !== -1) {
        v =
          v.slice(0, firstSlash + 1) +
          v.slice(firstSlash + 1).replace(/\//g, "");
      }
      cleanValue = v
        .split("/")
        .map((part) => part.slice(0, MOBILE_SEGMENT_LENGTH))
        .join("/");
    }

    setFormData((prev) => ({
      ...prev,
      [name]: cleanValue,
    }));
  };

  const handleTimeChange = (part, value) => {
    setFormData((prev) => {
      const current = parseTime(prev.counselling_time);
      const next = { ...current, [part]: value };
      return {
        ...prev,
        counselling_time: composeTime(next.hour, next.minute, next.period),
      };
    });
  };

  const toggleUpdateChannel = (channel) => {
    setFormData((prev) => {
      const has = prev.interested_updates.includes(channel);
      return {
        ...prev,
        interested_updates: has
          ? prev.interested_updates.filter((c) => c !== channel)
          : [...prev.interested_updates, channel],
      };
    });
  };

  const toggleHeardSource = (option) => {
    setFormData((prev) => {
      const has = prev.heard_source.includes(option);
      return {
        ...prev,
        heard_source: has
          ? prev.heard_source.filter((o) => o !== option)
          : [...prev.heard_source, option],
      };
    });
  };

  const sanitizeDate = (value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : "";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        ...formData,
        sheet_date: sanitizeDate(formData.sheet_date),
        date_of_joining: sanitizeDate(formData.date_of_joining),
        counselling_date: sanitizeDate(formData.counselling_date),
        heard_source: formData.heard_source.join(", "),
        interested_updates: formData.interested_updates.join(", "),
      };
      const response = editingId
        ? await API.put(`/information-sheets/${editingId}`, payload)
        : await API.post("/information-sheets", payload);
      closeModal();
      await fetchSheets();
      setToast({
        variant: "success",
        message:
          response.data.message || "Information sheet saved successfully",
      });
    } catch (err) {
      setToast({
        variant: "danger",
        message:
          err.response?.data?.message || "Failed to save information sheet.",
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
      await API.delete(`/information-sheets/${pendingDeleteId}`);
      Modal.getOrCreateInstance(deleteModalRef.current).hide();
      await fetchSheets();
      setToast({
        variant: "success",
        message: "Information sheet removed successfully",
      });
    } catch (err) {
      setToast({
        variant: "danger",
        message:
          err.response?.data?.message || "Failed to delete information sheet.",
      });
    }
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

      <div className="card shadow-sm">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
            <h4 className="mb-0">Information Sheet</h4>
            <div className="d-flex gap-2 flex-wrap">
              <Link
                to="/information-sheet/inactive"
                className="btn btn-outline-danger btn-sm"
              >
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
                onClick={openAddModal}
              >
                <i className="bi bi-plus-lg me-1"></i> Add Information Sheet
              </button>
            </div>
          </div>

          <div className="d-flex gap-2 flex-wrap mb-3">
            <button
              type="button"
              className={`btn btn-sm ${joinFilter === "all" ? "btn-primary" : "btn-outline-primary"}`}
              onClick={() => setJoinFilter("all")}
            >
              All Records
            </button>
            <button
              type="button"
              className={`btn btn-sm ${joinFilter === "joined" ? "btn-success" : "btn-outline-success"}`}
              onClick={() => setJoinFilter("joined")}
            >
              <i className="bi bi-check-circle me-1"></i> Joined
            </button>
            <button
              type="button"
              className={`btn btn-sm ${joinFilter === "not_joined" ? "btn-secondary" : "btn-outline-secondary"}`}
              onClick={() => setJoinFilter("not_joined")}
            >
              <i className="bi bi-x-circle me-1"></i> Not Joined
            </button>
          </div>

          <div className="input-group mb-3" style={{ maxWidth: "350px" }}>
            <span className="input-group-text bg-white">
              <i className="bi bi-search"></i>
            </span>
            <input
              type="text"
              className="form-control"
              placeholder="Search by Name, Mobile No, or Course..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="table-responsive">
            <table className="table table-striped table-hover align-middle">
              <thead className="table-primary">
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Mobile</th>
                  <th>Course Interested</th>
                  <th>Plan to Join</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {paginatedSheets.length === 0 ? (
                  <tr>
                    <td className="text-center text-muted" colSpan={6}>
                      No information sheets found.
                    </td>
                  </tr>
                ) : (
                  paginatedSheets.map((s, index) => (
                    <tr key={s.id}>
                      <td>{(currentPage - 1) * ROWS_PER_PAGE + index + 1}</td>
                      <td>{s.applicant_name || "-"}</td>
                      <td>{s.mobile_no || "-"}</td>
                      <td>{s.course_interested || "-"}</td>
                      <td>
                        {s.is_joined ? (
                          <span className="badge bg-success">Joined</span>
                        ) : (
                          s.effective_plan_to_join || "-"
                        )}
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
                          onClick={() => openEditModal(s)}
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
              {filteredSheets.length === 0
                ? 0
                : (currentPage - 1) * ROWS_PER_PAGE + 1}
              –{Math.min(currentPage * ROWS_PER_PAGE, filteredSheets.length)}{" "}
              of {filteredSheets.length} records
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

      <div className="modal fade" id="infoSheetModal" tabIndex="-1" ref={modalRef}>
        <div className="modal-dialog modal-lg modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">
                {editingId ? "Edit Information Sheet" : "Add Information Sheet"}
              </h5>
              <button
                type="button"
                className="btn-close"
                data-bs-dismiss="modal"
              ></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div
                className="modal-body"
                style={{ maxHeight: "70vh", overflowY: "auto" }}
              >
                <div className="row g-3 mb-2">
                  <div className="col-md-3">
                    <label className="form-label">Date</label>
                    <input
                      type="date"
                      name="sheet_date"
                      className="form-control"
                      value={formData.sheet_date}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="col-md-5">
                    <label className="form-label">Name</label>
                    <input
                      type="text"
                      name="applicant_name"
                      className="form-control"
                      value={formData.applicant_name}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">
                      Father's / Husband's Name
                    </label>
                    <input
                      type="text"
                      name="father_husband_name"
                      className="form-control"
                      value={formData.father_husband_name}
                      onChange={handleChange}
                    />
                  </div>

                  <div className="col-md-8">
                    <label className="form-label">Address</label>
                    <input
                      type="text"
                      name="address"
                      className="form-control"
                      value={formData.address}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Pin Code</label>
                    <input
                      type="text"
                      name="pin_code"
                      maxLength={6}
                      className="form-control"
                      value={formData.pin_code}
                      onChange={handleChange}
                    />
                  </div>

                  <div className="col-md-6">
                    <label className="form-label">Mobile / Telephone No</label>
                    <input
                      type="text"
                      name="mobile_no"
                      className="form-control"
                      placeholder="e.g. 9876543210/5425433"
                      value={formData.mobile_no}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Email</label>
                    <input
                      type="email"
                      name="email"
                      className="form-control"
                      value={formData.email}
                      onChange={handleChange}
                    />
                  </div>

                  <div className="col-md-4">
                    <label className="form-label d-block">Sex</label>
                    {["M", "F"].map((opt) => (
                      <div className="form-check form-check-inline" key={opt}>
                        <input
                          className="form-check-input"
                          type="radio"
                          name="sex"
                          value={opt}
                          checked={formData.sex === opt}
                          onChange={handleChange}
                        />
                        <label className="form-check-label">{opt}</label>
                      </div>
                    ))}
                  </div>
                  <div className="col-md-4">
                    <label className="form-label d-block">Religion</label>
                    {["Hindu", "Christian", "Muslim", "Others"].map((opt) => (
                      <div className="form-check form-check-inline" key={opt}>
                        <input
                          className="form-check-input"
                          type="radio"
                          name="religion"
                          value={opt}
                          checked={formData.religion === opt}
                          onChange={handleChange}
                        />
                        <label className="form-check-label">{opt}</label>
                      </div>
                    ))}
                  </div>
                  <div className="col-md-4">
                    <label className="form-label d-block">Community</label>
                    {["OC", "BC", "MBC", "ST/SC", "Others"].map((opt) => (
                      <div className="form-check form-check-inline" key={opt}>
                        <input
                          className="form-check-input"
                          type="radio"
                          name="community"
                          value={opt}
                          checked={formData.community === opt}
                          onChange={handleChange}
                        />
                        <label className="form-check-label">{opt}</label>
                      </div>
                    ))}
                  </div>
                </div>

                <hr />

                <div className="row g-3">
                  <div className="col-md-4">
                    <label className="form-label">
                      Educational Qualification
                    </label>
                    <select
                      name="educational_qualification"
                      className="form-select"
                      value={formData.educational_qualification}
                      onChange={handleChange}
                    >
                      <option value="">Select</option>
                      {QUALIFICATION_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Qualification Status</label>
                    <select
                      name="qualification_status"
                      className="form-select"
                      value={formData.qualification_status}
                      onChange={handleChange}
                    >
                      <option value="">Select</option>
                      <option value="Completed">Completed</option>
                      <option value="Undergoing">Undergoing</option>
                    </select>
                  </div>

                  {formData.qualification_status === "Undergoing" && (
                    <>
                      <div className="col-md-4">
                        <label className="form-label">Which Year</label>
                        <input
                          type="text"
                          name="qualification_year"
                          className="form-control"
                          value={formData.qualification_year}
                          onChange={handleChange}
                        />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">Subject</label>
                        <input
                          type="text"
                          name="qualification_subject"
                          className="form-control"
                          value={formData.qualification_subject}
                          onChange={handleChange}
                        />
                      </div>
                    </>
                  )}

                  <div className="col-md-4">
                    <label className="form-label d-block">
                      Are You (Occupation)
                    </label>
                    {[
                      "Student",
                      "House Wife",
                      "Employed",
                      "Un-employed",
                      "Business",
                    ].map((opt) => (
                      <div className="form-check form-check-inline" key={opt}>
                        <input
                          className="form-check-input"
                          type="radio"
                          name="occupation"
                          value={opt}
                          checked={formData.occupation === opt}
                          onChange={handleChange}
                        />
                        <label className="form-check-label">{opt}</label>
                      </div>
                    ))}
                  </div>

                  <div className="col-md-6">
                    <label className="form-label">
                      Family Income Per Month
                    </label>
                    <select
                      name="family_income"
                      className="form-select"
                      value={formData.family_income}
                      onChange={handleChange}
                    >
                      <option value="">Select</option>
                      <option value="Less than 8000">
                        Less than Rs. 8,000
                      </option>
                      <option value="8001-15000">
                        Rs. 8,001 - 15,000
                      </option>
                      <option value="More than 15000">
                        More than Rs. 15,000
                      </option>
                    </select>
                  </div>
                  <div className="col-md-6"></div>

                  <div className="col-md-6">
                    <label className="form-label">
                      Prior Computer Course — Institution
                    </label>
                    <input
                      type="text"
                      name="prior_course_institution"
                      className="form-control"
                      value={formData.prior_course_institution}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">
                      Prior Computer Course — Subject
                    </label>
                    <input
                      type="text"
                      name="prior_course_subject"
                      className="form-control"
                      value={formData.prior_course_subject}
                      onChange={handleChange}
                    />
                  </div>

                  <div className="col-md-6">
                    <label className="form-label">
                      Why Study Computer Course
                    </label>
                    <select
                      name="study_reason"
                      className="form-select"
                      value={formData.study_reason}
                      onChange={handleChange}
                    >
                      <option value="">Select</option>
                      <option value="For a Job">For a Job</option>
                      <option value="Additional Qualification">
                        Additional Qualification
                      </option>
                      <option value="Gaining Knowledge">
                        Gaining Knowledge
                      </option>
                      <option value="Sponsored by Company">
                        Sponsored by Company
                      </option>
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Course Interested to Join</label>
                    <input
                      type="text"
                      name="course_interested"
                      className="form-control"
                      value={formData.course_interested}
                      onChange={handleChange}
                    />
                  </div>

                  <div className="col-md-6">
                    <label className="form-label">Preferred Timings</label>
                    <input
                      type="text"
                      name="preferred_timings"
                      className="form-control"
                      value={formData.preferred_timings}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Plan to Join</label>
                    {editingIsJoined ? (
                      <>
                        <input
                          type="text"
                          className="form-control"
                          value="Joined"
                          disabled
                        />
                        <div className="form-text">
                          Auto-detected — this person is already in the
                          Admission List.
                        </div>
                      </>
                    ) : (
                      <select
                        name="plan_to_join"
                        className="form-select"
                        value={formData.plan_to_join}
                        onChange={handleChange}
                      >
                        <option value="">Select</option>
                        <option value="Immediately">Immediately</option>
                        <option value="Within a week">Within a week</option>
                        <option value="Within a month">Within a month</option>
                        <option value="Joined">Joined</option>
                      </select>
                    )}
                  </div>

                  <div className="col-12">
                    <label className="form-label d-block">
                      How Did You Know About Us (select all that apply)
                    </label>
                    <div className="row g-3">
                      {Object.entries(SOURCE_SUB_OPTIONS).map(
                        ([category, options]) => (
                          <div className="col-md-4" key={category}>
                            <div className="fw-bold small text-muted mb-1">
                              {category}
                            </div>
                            {options.map((opt) => {
                              const value = `${category}: ${opt}`;
                              return (
                                <div className="form-check" key={opt}>
                                  <input
                                    className="form-check-input"
                                    type="checkbox"
                                    checked={formData.heard_source.includes(
                                      value
                                    )}
                                    onChange={() => toggleHeardSource(value)}
                                  />
                                  <label className="form-check-label">
                                    {opt}
                                  </label>
                                </div>
                              );
                            })}
                          </div>
                        )
                      )}
                    </div>
                  </div>

                  <div className="col-md-6">
                    <label className="form-label d-block">
                      Interested in Updates Via
                    </label>
                    {UPDATE_CHANNELS.map((channel) => (
                      <div
                        className="form-check form-check-inline"
                        key={channel}
                      >
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={formData.interested_updates.includes(
                            channel
                          )}
                          onChange={() => toggleUpdateChannel(channel)}
                        />
                        <label className="form-check-label">{channel}</label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border rounded p-3 mt-4 bg-light position-relative">
                  <span
                    className="badge bg-secondary position-absolute"
                    style={{ top: "-10px", left: "16px" }}
                  >
                    For Office Use Only
                  </span>
                  <div className="row g-3 pt-2">
                    <div className="col-md-4">
                      <label className="form-label">E.No</label>
                      <input
                        type="text"
                        name="enrol_no"
                        className="form-control"
                        value={formData.enrol_no}
                        onChange={handleChange}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">Course</label>
                      <input
                        type="text"
                        name="course"
                        className="form-control"
                        value={formData.course}
                        onChange={handleChange}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">DOJ</label>
                      <input
                        type="date"
                        name="date_of_joining"
                        className="form-control"
                        value={formData.date_of_joining}
                        onChange={handleChange}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">
                        Counselling Handled By
                      </label>
                      <input
                        type="text"
                        name="counselling_handled_by"
                        className="form-control"
                        value={formData.counselling_handled_by}
                        onChange={handleChange}
                      />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label">Counselling Date</label>
                      <input
                        type="date"
                        name="counselling_date"
                        className="form-control"
                        value={formData.counselling_date}
                        onChange={handleChange}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label d-block">
                        Counselling Time
                      </label>
                      <div className="d-flex gap-2">
                        <select
                          className="form-select"
                          value={parseTime(formData.counselling_time).hour}
                          onChange={(e) =>
                            handleTimeChange("hour", e.target.value)
                          }
                        >
                          <option value="">HH</option>
                          {HOURS.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                        <select
                          className="form-select"
                          value={parseTime(formData.counselling_time).minute}
                          onChange={(e) =>
                            handleTimeChange("minute", e.target.value)
                          }
                        >
                          <option value="">MM</option>
                          {MINUTES.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                        <select
                          className="form-select"
                          value={parseTime(formData.counselling_time).period}
                          onChange={(e) =>
                            handleTimeChange("period", e.target.value)
                          }
                        >
                          <option value="">--</option>
                          <option value="AM">AM</option>
                          <option value="PM">PM</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
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

      <div
        className="modal fade"
        id="infoSheetDeleteModal"
        tabIndex="-1"
        ref={deleteModalRef}
      >
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Remove Information Sheet</h5>
              <button
                type="button"
                className="btn-close"
                data-bs-dismiss="modal"
              ></button>
            </div>
            <div className="modal-body">
              Are you sure you want to remove this information sheet entry?
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

      <div
        className="modal fade"
        id="infoSheetViewModal"
        tabIndex="-1"
        ref={viewModalRef}
      >
        <div className="modal-dialog modal-lg modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">
                Information Sheet — {viewSheet?.applicant_name}
              </h5>
              <button
                type="button"
                className="btn-close"
                data-bs-dismiss="modal"
              ></button>
            </div>
            <div className="modal-body">
              {viewSheet && (
                <div className="row g-3">
                  {VIEW_FIELDS.map((field) => (
                    <div className="col-md-4" key={field.key}>
                      <div className="text-muted small fw-bold text-uppercase">
                        {field.label}
                      </div>
                      <div>{viewSheet[field.key] || "-"}</div>
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

export default InformationSheetEntry;
