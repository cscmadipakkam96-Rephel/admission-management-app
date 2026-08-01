import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Modal } from "bootstrap";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import API from "../../api/api";

const initialForm = {
  teacher_name: "",
  mobile_no: "",
  email: "",
  password: "",
  qualification: "",
  joining_date: "",
  salary: "",
  status: "Active",
};

const STATUSES = ["Active", "Inactive"];

const STATUS_BADGE = {
  Active: "bg-success",
  Inactive: "bg-secondary",
};

const EXPORT_COLUMNS = [
  { key: "teacher_name", label: "Teacher Name" },
  { key: "mobile_no", label: "Mobile No" },
  { key: "email", label: "Email" },
  { key: "qualification", label: "Qualification" },
  { key: "joining_date", label: "Joining Date" },
  { key: "salary", label: "Salary" },
  { key: "status", label: "Status" },
];

const SORT_OPTIONS = [
  { key: "teacher_name", label: "Name" },
  { key: "joining_date", label: "Joining Date" },
  { key: "salary", label: "Salary" },
];

function TeacherManagement() {
  const modalRef = useRef(null);
  const deleteModalRef = useRef(null);
  const viewModalRef = useRef(null);

  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortField, setSortField] = useState("teacher_name");
  const [sortOrder, setSortOrder] = useState("asc");
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(initialForm);
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [viewTeacher, setViewTeacher] = useState(null);
  const [courses, setCourses] = useState([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState([]);
  const [courseSearchTerm, setCourseSearchTerm] = useState("");
  const [admissions, setAdmissions] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const ROWS_PER_PAGE = 10;

  const fetchTeachers = async () => {
    try {
      const response = await API.get("/teachers?active=true");
      setTeachers(response.data.data);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load teachers.");
    } finally {
      setLoading(false);
    }
  };

  const fetchCourses = async () => {
    try {
      const response = await API.get("/courses?active=true");
      setCourses(response.data.data);
    } catch {
      // Course list is a secondary feature here; ignore failures silently.
    }
  };

  const fetchAdmissions = async () => {
    try {
      const response = await API.get("/admissions");
      setAdmissions(response.data.data);
    } catch {
      // Assigned-students list is a secondary feature here; ignore failures silently.
    }
  };

  useEffect(() => {
    fetchTeachers();
    fetchCourses();
    fetchAdmissions();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, sortField, sortOrder]);

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

  const getAssignedStudents = (teacherCourses) => {
    const courseNames = new Set(
      (teacherCourses || [])
        .map((c) => (c.course_name || "").trim().toLowerCase())
        .filter(Boolean)
    );
    if (courseNames.size === 0) return [];
    return admissions.filter((a) =>
      courseNames.has((a.course_name || "").trim().toLowerCase())
    );
  };

  const summary = {
    total: teachers.length,
    active: teachers.filter((t) => t.status === "Active").length,
  };

  const filteredTeachers = teachers
    .filter((t) => {
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      const matchesOwnFields = Object.entries(t).some(
        ([key, value]) =>
          key !== "Courses" &&
          value !== null &&
          value !== undefined &&
          value.toString().toLowerCase().includes(term)
      );
      if (matchesOwnFields) return true;
      return (t.Courses || []).some((c) =>
        (c.course_name || "").toLowerCase().includes(term)
      );
    })
    .filter((t) => (statusFilter ? t.status === statusFilter : true));

  const sortedTeachers = [...filteredTeachers].sort((a, b) => {
    const valA = a[sortField] ?? "";
    const valB = b[sortField] ?? "";
    let result;
    if (sortField === "salary") {
      result = (Number(valA) || 0) - (Number(valB) || 0);
    } else if (sortField === "joining_date") {
      result = new Date(valA || 0) - new Date(valB || 0);
    } else {
      result = valA.toString().localeCompare(valB.toString());
    }
    return sortOrder === "asc" ? result : -result;
  });

  const totalPages = Math.max(
    1,
    Math.ceil(sortedTeachers.length / ROWS_PER_PAGE)
  );
  const paginatedTeachers = sortedTeachers.slice(
    (currentPage - 1) * ROWS_PER_PAGE,
    currentPage * ROWS_PER_PAGE
  );

  const filteredCourseOptions = (() => {
    const term = courseSearchTerm.trim().toLowerCase();
    if (!term) return courses;
    return courses.filter((c) =>
      (c.course_name || "").toLowerCase().includes(term)
    );
  })();

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

  const openAddModal = () => {
    setEditingId(null);
    setFormData(initialForm);
    setFormErrors({});
    setSelectedCourseIds([]);
    setCourseSearchTerm("");
    Modal.getOrCreateInstance(modalRef.current).show();
  };

  const openEditModal = (teacher) => {
    setEditingId(teacher.id);
    setFormData({
      teacher_name: teacher.teacher_name || "",
      mobile_no: teacher.mobile_no || "",
      email: teacher.email || "",
      password: "",
      qualification: teacher.qualification || "",
      joining_date: teacher.joining_date || "",
      salary: teacher.salary || "",
      status: teacher.status || "Active",
    });
    setFormErrors({});
    setSelectedCourseIds((teacher.Courses || []).map((c) => c.id));
    setCourseSearchTerm("");
    Modal.getOrCreateInstance(modalRef.current).show();
  };

  const closeModal = () => {
    Modal.getOrCreateInstance(modalRef.current).hide();
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

  const toggleCourseSelection = (courseId) => {
    setSelectedCourseIds((prev) =>
      prev.includes(courseId)
        ? prev.filter((id) => id !== courseId)
        : [...prev, courseId]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const clientErrors = {};
    if (!formData.teacher_name.trim()) {
      clientErrors.teacher_name = "Teacher Name is required.";
    }
    if (!editingId) {
      if (!formData.email.trim()) {
        clientErrors.email = "Email is required so this teacher can log in.";
      }
      if (!formData.password || formData.password.length < 4) {
        clientErrors.password = "Password must be at least 4 characters.";
      }
    } else if (formData.password && formData.password.length < 4) {
      clientErrors.password = "Password must be at least 4 characters.";
    }
    if (Object.keys(clientErrors).length > 0) {
      setFormErrors(clientErrors);
      return;
    }
    setSubmitting(true);
    try {
      const response = editingId
        ? await API.put(`/teachers/${editingId}`, formData)
        : await API.post("/teachers", formData);
      const teacherId = editingId || response.data.data.id;
      await API.put(`/teachers/${teacherId}/courses`, {
        course_ids: selectedCourseIds,
      });
      closeModal();
      await fetchTeachers();
      setToast({
        variant: "success",
        message: "Teacher saved successfully",
      });
    } catch (err) {
      const serverErrors = err.response?.data?.errors;
      if (serverErrors) {
        setFormErrors(serverErrors);
      } else {
        setToast({
          variant: "danger",
          message: err.response?.data?.message || "Failed to save teacher.",
        });
      }
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
      await API.delete(`/teachers/${pendingDeleteId}`);
      Modal.getOrCreateInstance(deleteModalRef.current).hide();
      await fetchTeachers();
      setToast({ variant: "success", message: "Teacher removed successfully" });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to delete teacher.",
      });
    }
  };

  const openViewModal = (teacher) => {
    setViewTeacher(teacher);
    Modal.getOrCreateInstance(viewModalRef.current).show();
  };

  const copyLoginLink = async (teacher) => {
    const link = `${window.location.origin}/teacher-login/${teacher.slug}`;
    try {
      await navigator.clipboard.writeText(link);
      setToast({
        variant: "success",
        message: `Login link copied for ${teacher.teacher_name}`,
      });
    } catch {
      setToast({ variant: "danger", message: link });
    }
  };

  const exportToExcel = () => {
    const data = sortedTeachers.map((t) => {
      const record = {};
      EXPORT_COLUMNS.forEach((col) => {
        record[col.label] = t[col.key] ?? "";
      });
      record["Courses"] = (t.Courses || [])
        .map((c) => c.course_name)
        .join(", ");
      return record;
    });
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Teachers");
    XLSX.writeFile(workbook, "teachers.xlsx");
  };

  const exportToPDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    const head = [[...EXPORT_COLUMNS.map((c) => c.label), "Courses"]];
    const body = sortedTeachers.map((t) => [
      ...EXPORT_COLUMNS.map((c) => t[c.key] ?? "-"),
      (t.Courses || []).map((c) => c.course_name).join(", ") || "-",
    ]);
    autoTable(doc, {
      head,
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [29, 78, 216] },
    });
    doc.save("teachers.pdf");
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
    <div className="container-fluid" style={{ maxWidth: "1200px" }}>
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
                Total Teachers
              </div>
              <div className="fs-3 fw-bold text-primary">{summary.total}</div>
            </div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card shadow-sm h-100">
            <div className="card-body text-center">
              <div className="text-muted small text-uppercase fw-bold">
                Active Teachers
              </div>
              <div className="fs-3 fw-bold text-success">
                {summary.active}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card shadow-sm">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
            <h4 className="mb-0">Teacher Management</h4>
            <div className="d-flex gap-2 flex-wrap">
              <Link to="/teachers/inactive" className="btn btn-outline-danger btn-sm">
                <i className="bi bi-person-x me-1"></i> Inactive Records
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
                <i className="bi bi-plus-lg me-1"></i> Add Teacher
              </button>
            </div>
          </div>

          <div className="row g-2 mb-3">
            <div className="col-md-4">
              <div className="input-group">
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
            </div>
            <div className="col-6 col-md-2">
              <select
                className="form-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All Status</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-3">
              <select
                className="form-select"
                value={`${sortField}:${sortOrder}`}
                onChange={(e) => {
                  const [field, order] = e.target.value.split(":");
                  setSortField(field);
                  setSortOrder(order);
                }}
              >
                {SORT_OPTIONS.map((opt) => (
                  <optgroup key={opt.key} label={`Sort by ${opt.label}`}>
                    <option value={`${opt.key}:asc`}>
                      {opt.label} (A–Z / Low–High)
                    </option>
                    <option value={`${opt.key}:desc`}>
                      {opt.label} (Z–A / High–Low)
                    </option>
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          <div className="table-responsive">
            <table className="table table-striped table-hover align-middle">
              <thead className="table-primary">
                <tr>
                  <th>#</th>
                  <th
                    role="button"
                    onClick={() => handleSort("teacher_name")}
                  >
                    Teacher Name{" "}
                    <i className={`bi ${sortIcon("teacher_name")}`}></i>
                  </th>
                  <th>Mobile No</th>
                  <th>Email</th>
                  <th>Qualification</th>
                  <th>Courses</th>
                  <th
                    role="button"
                    onClick={() => handleSort("joining_date")}
                  >
                    Joining Date{" "}
                    <i className={`bi ${sortIcon("joining_date")}`}></i>
                  </th>
                  <th role="button" onClick={() => handleSort("salary")}>
                    Salary <i className={`bi ${sortIcon("salary")}`}></i>
                  </th>
                  <th>Status</th>
                  <th>Assigned Students</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedTeachers.length === 0 ? (
                  <tr>
                    <td className="text-center text-muted py-4" colSpan={11}>
                      <i className="bi bi-inbox fs-3 d-block mb-2"></i>
                      No teachers found.
                    </td>
                  </tr>
                ) : (
                  paginatedTeachers.map((t, index) => (
                    <tr key={t.id}>
                      <td>{(currentPage - 1) * ROWS_PER_PAGE + index + 1}</td>
                      <td>{t.teacher_name}</td>
                      <td>{t.mobile_no || "-"}</td>
                      <td>{t.email || "-"}</td>
                      <td>{t.qualification || "-"}</td>
                      <td>
                        {(t.Courses || []).length === 0
                          ? "-"
                          : t.Courses.map((c) => (
                              <span
                                key={c.id}
                                className="badge bg-info text-dark me-1"
                              >
                                {c.course_name}
                              </span>
                            ))}
                      </td>
                      <td>{t.joining_date || "-"}</td>
                      <td>{t.salary || "-"}</td>
                      <td>
                        <span
                          className={`badge ${STATUS_BADGE[t.status] || "bg-secondary"}`}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td>
                        <span className="badge bg-warning text-dark">
                          {getAssignedStudents(t.Courses).length}
                        </span>
                      </td>
                      <td className="d-flex gap-2">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-info"
                          title="Copy Login Link"
                          onClick={() => copyLoginLink(t)}
                        >
                          <i className="bi bi-link-45deg"></i>
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          title="View"
                          onClick={() => openViewModal(t)}
                        >
                          <i className="bi bi-eye"></i>
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          title="Edit"
                          onClick={() => openEditModal(t)}
                        >
                          <i className="bi bi-pencil"></i>
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          title="Delete"
                          onClick={() => confirmDelete(t.id)}
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
              {sortedTeachers.length === 0
                ? 0
                : (currentPage - 1) * ROWS_PER_PAGE + 1}
              –
              {Math.min(currentPage * ROWS_PER_PAGE, sortedTeachers.length)}{" "}
              of {sortedTeachers.length} teachers
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

      {/* Add/Edit Teacher Modal */}
      <div className="modal fade" id="teacherModal" tabIndex="-1" ref={modalRef}>
        <div className="modal-dialog modal-lg modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">
                {editingId ? "Edit Teacher" : "Add Teacher"}
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
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label">Teacher Name</label>
                    <input
                      type="text"
                      name="teacher_name"
                      className={`form-control ${formErrors.teacher_name ? "is-invalid" : ""}`}
                      value={formData.teacher_name}
                      onChange={handleChange}
                    />
                    {formErrors.teacher_name && (
                      <div className="invalid-feedback">
                        {formErrors.teacher_name}
                      </div>
                    )}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Mobile No</label>
                    <input
                      type="text"
                      name="mobile_no"
                      className="form-control"
                      value={formData.mobile_no}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Email</label>
                    <input
                      type="email"
                      name="email"
                      className={`form-control ${formErrors.email ? "is-invalid" : ""}`}
                      value={formData.email}
                      onChange={handleChange}
                    />
                    {formErrors.email && (
                      <div className="invalid-feedback">{formErrors.email}</div>
                    )}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">
                      Password{" "}
                      <span className="text-muted small fw-normal">
                        {editingId ? "(leave blank to keep current)" : ""}
                      </span>
                    </label>
                    <input
                      type="password"
                      name="password"
                      className={`form-control ${formErrors.password ? "is-invalid" : ""}`}
                      value={formData.password}
                      onChange={handleChange}
                      placeholder={editingId ? "" : "Used to log in on the Teacher Login page"}
                    />
                    {formErrors.password && (
                      <div className="invalid-feedback">
                        {formErrors.password}
                      </div>
                    )}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Qualification</label>
                    <input
                      type="text"
                      name="qualification"
                      className="form-control"
                      value={formData.qualification}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Joining Date</label>
                    <input
                      type="date"
                      name="joining_date"
                      className="form-control"
                      value={formData.joining_date}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Monthly Salary</label>
                    <input
                      type="number"
                      name="salary"
                      className={`form-control ${formErrors.salary ? "is-invalid" : ""}`}
                      value={formData.salary}
                      onChange={handleChange}
                    />
                    {formErrors.salary && (
                      <div className="invalid-feedback">
                        {formErrors.salary}
                      </div>
                    )}
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Status</label>
                    <select
                      name="status"
                      className="form-select"
                      value={formData.status}
                      onChange={handleChange}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-12">
                    <label className="form-label d-block">
                      Courses this teacher will take
                    </label>
                    {courses.length === 0 ? (
                      <div className="text-muted small">
                        No courses added yet — go to Course Management to add
                        some.
                      </div>
                    ) : (
                      <div className="border rounded p-2">
                        <div className="input-group input-group-sm mb-2">
                          <span className="input-group-text bg-white">
                            <i className="bi bi-search"></i>
                          </span>
                          <input
                            type="text"
                            className="form-control"
                            placeholder="Search course..."
                            value={courseSearchTerm}
                            onChange={(e) =>
                              setCourseSearchTerm(e.target.value)
                            }
                          />
                        </div>
                        {filteredCourseOptions.length === 0 ? (
                          <div className="text-muted small">
                            No courses match your search.
                          </div>
                        ) : (
                          <div className="row g-2">
                            {filteredCourseOptions.map((course) => (
                              <div className="col-md-4" key={course.id}>
                                <div className="form-check">
                                  <input
                                    className="form-check-input"
                                    type="checkbox"
                                    checked={selectedCourseIds.includes(
                                      course.id
                                    )}
                                    onChange={() =>
                                      toggleCourseSelection(course.id)
                                    }
                                  />
                                  <label className="form-check-label">
                                    {course.course_name}
                                  </label>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="text-muted small mt-2 mb-0">
                          Students already enrolled in the selected course(s)
                          will show up as this teacher's assigned students
                          automatically.
                        </div>
                      </div>
                    )}
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

      {/* View Modal */}
      <div className="modal fade" id="teacherViewModal" tabIndex="-1" ref={viewModalRef}>
        <div className="modal-dialog modal-lg modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Teacher Details</h5>
              <button
                type="button"
                className="btn-close"
                data-bs-dismiss="modal"
              ></button>
            </div>
            <div className="modal-body">
              {viewTeacher && (
                <div className="row g-3">
                  {EXPORT_COLUMNS.map((col) => (
                    <div className="col-md-4" key={col.key}>
                      <div className="text-muted small fw-bold text-uppercase">
                        {col.label}
                      </div>
                      <div>{viewTeacher[col.key] || "-"}</div>
                    </div>
                  ))}
                  <div className="col-md-4">
                    <div className="text-muted small fw-bold text-uppercase">
                      Login Password
                    </div>
                    <div>
                      {viewTeacher.has_password ? (
                        <span className="badge bg-success">
                          <i className="bi bi-check-lg me-1"></i>Set
                        </span>
                      ) : (
                        <span className="badge bg-warning text-dark">
                          <i className="bi bi-exclamation-triangle me-1"></i>
                          Not set — can't log in yet
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="col-12">
                    <div className="text-muted small fw-bold text-uppercase">
                      Courses
                    </div>
                    <div>
                      {(viewTeacher.Courses || []).length === 0
                        ? "-"
                        : viewTeacher.Courses.map((c) => (
                            <span
                              key={c.id}
                              className="badge bg-info text-dark me-1"
                            >
                              {c.course_name}
                            </span>
                          ))}
                    </div>
                  </div>
                  <div className="col-12">
                    <div className="text-muted small fw-bold text-uppercase">
                      Assigned Students (
                      {getAssignedStudents(viewTeacher.Courses).length})
                    </div>
                    {getAssignedStudents(viewTeacher.Courses).length === 0 ? (
                      <div className="text-muted">
                        No students found for this teacher's course(s) yet.
                      </div>
                    ) : (
                      <ol className="mb-0 ps-3">
                        {getAssignedStudents(viewTeacher.Courses).map((a) => (
                          <li key={a.id}>
                            {a.applicant_name}
                            <span className="text-muted">
                              {" "}
                              — {a.course_name}
                              {a.mobile_no && ` — ${a.mobile_no}`}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
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

      {/* Delete Confirmation Modal */}
      <div
        className="modal fade"
        id="teacherDeleteModal"
        tabIndex="-1"
        ref={deleteModalRef}
      >
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Remove Teacher</h5>
              <button
                type="button"
                className="btn-close"
                data-bs-dismiss="modal"
              ></button>
            </div>
            <div className="modal-body">
              Are you sure you want to remove this teacher?
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

export default TeacherManagement;
