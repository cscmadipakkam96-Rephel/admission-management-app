import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Modal } from "bootstrap";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import API from "../../api/api";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const initialForm = {
  course_code: "",
  course_name: "",
  category: "",
  description: "",
  level: "",
  project: "",
  status: "Active",
  duration: "",
  standard_fee: "",
  timings: "",
  total_seats: "",
};

const LEVELS = ["Beginner", "Intermediate", "Advanced"];
const STATUSES = ["Active", "Upcoming", "Completed"];

const STATUS_BADGE = {
  Active: "bg-success",
  Upcoming: "bg-warning",
  Completed: "bg-secondary",
};

const EXPORT_COLUMNS = [
  { key: "course_code", label: "Course Code" },
  { key: "course_name", label: "Course Name" },
  { key: "category", label: "Category" },
  { key: "level", label: "Level" },
  { key: "project", label: "Project" },
  { key: "duration", label: "Duration" },
  { key: "standard_fee", label: "Standard Fee" },
  { key: "timings", label: "Timings" },
  { key: "total_seats", label: "Total Seats" },
  { key: "status", label: "Status" },
];

const SORT_OPTIONS = [
  { key: "course_code", label: "Course Code" },
  { key: "course_name", label: "Name" },
  { key: "standard_fee", label: "Fee" },
  { key: "duration", label: "Duration" },
  { key: "total_seats", label: "Seats" },
];

function CourseManagement() {
  const modalRef = useRef(null);
  const deleteModalRef = useRef(null);
  const viewModalRef = useRef(null);

  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [sortField, setSortField] = useState("course_name");
  const [sortOrder, setSortOrder] = useState("asc");
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(initialForm);
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [viewCourse, setViewCourse] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState([]);
  const [subjectSearchTerm, setSubjectSearchTerm] = useState("");
  const [admissions, setAdmissions] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const ROWS_PER_PAGE = 10;

  const fetchCourses = async () => {
    try {
      const response = await API.get("/courses?active=true");
      setCourses(response.data.data);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load courses.");
    } finally {
      setLoading(false);
    }
  };

  const fetchSubjects = async () => {
    try {
      const response = await API.get("/subjects?active=true");
      setSubjects(response.data.data);
    } catch {
      // Subjects list is a secondary feature here; ignore failures silently.
    }
  };

  const fetchAdmissions = async () => {
    try {
      const response = await API.get("/admissions");
      setAdmissions(response.data.data);
    } catch {
      // Enrolled-students list is a secondary feature here; ignore failures silently.
    }
  };

  const fetchTeachers = async () => {
    try {
      const response = await API.get("/teachers?active=true");
      setTeachers(response.data.data);
    } catch {
      // Teachers-per-course list is a secondary feature here; ignore failures silently.
    }
  };

  useEffect(() => {
    fetchCourses();
    fetchSubjects();
    fetchAdmissions();
    fetchTeachers();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, categoryFilter, statusFilter, levelFilter, sortField, sortOrder]);

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

  const categories = Array.from(
    new Set(courses.map((c) => c.category).filter(Boolean))
  ).sort();

  const getEnrolledStudents = (courseName) => {
    const term = (courseName || "").trim().toLowerCase();
    if (!term) return [];
    return admissions.filter(
      (a) => (a.course_name || "").trim().toLowerCase() === term
    );
  };

  const courseStudentChartData = {
    labels: courses.map((c) => c.course_name),
    datasets: [
      {
        label: "Enrolled Students",
        data: courses.map((c) => getEnrolledStudents(c.course_name).length),
        backgroundColor: "#1d4ed8",
        borderRadius: 4,
      },
    ],
  };

  const getTeachersForCourse = (courseId) =>
    teachers.filter((t) => (t.Courses || []).some((c) => c.id === courseId));

  const courseTeacherChartData = {
    labels: courses.map((c) => c.course_name),
    datasets: [
      {
        label: "Teachers",
        data: courses.map((c) => getTeachersForCourse(c.id).length),
        backgroundColor: "#0d9488",
        borderRadius: 4,
      },
    ],
  };

  const summary = {
    total: courses.length,
    active: courses.filter((c) => c.status === "Active").length,
    totalSeats: courses.reduce((sum, c) => sum + (Number(c.total_seats) || 0), 0),
    availableSeats: courses
      .filter((c) => c.status === "Active")
      .reduce((sum, c) => sum + (Number(c.total_seats) || 0), 0),
  };

  const filteredCourses = courses
    .filter((c) => {
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      const matchesOwnFields = Object.entries(c).some(
        ([key, value]) =>
          key !== "Subjects" &&
          value !== null &&
          value !== undefined &&
          value.toString().toLowerCase().includes(term)
      );
      if (matchesOwnFields) return true;
      return (c.Subjects || []).some((s) =>
        (s.subject_name || "").toLowerCase().includes(term)
      );
    })
    .filter((c) => (categoryFilter ? c.category === categoryFilter : true))
    .filter((c) => (statusFilter ? c.status === statusFilter : true))
    .filter((c) => (levelFilter ? c.level === levelFilter : true));

  const sortedCourses = [...filteredCourses].sort((a, b) => {
    const valA = a[sortField] ?? "";
    const valB = b[sortField] ?? "";
    let result;
    if (sortField === "standard_fee" || sortField === "total_seats") {
      result = (Number(valA) || 0) - (Number(valB) || 0);
    } else if (
      sortField === "course_code" &&
      valA !== "" &&
      valB !== "" &&
      !isNaN(Number(valA)) &&
      !isNaN(Number(valB))
    ) {
      result = Number(valA) - Number(valB);
    } else {
      result = valA.toString().localeCompare(valB.toString());
    }
    return sortOrder === "asc" ? result : -result;
  });

  const totalPages = Math.max(
    1,
    Math.ceil(sortedCourses.length / ROWS_PER_PAGE)
  );
  const paginatedCourses = sortedCourses.slice(
    (currentPage - 1) * ROWS_PER_PAGE,
    currentPage * ROWS_PER_PAGE
  );

  const filteredSubjectOptions = (() => {
    const term = subjectSearchTerm.trim().toLowerCase();
    if (!term) return subjects;
    return subjects
      .map((subject) => {
        const parentMatches = (subject.subject_name || "")
          .toLowerCase()
          .includes(term);
        const matchingSubs = (subject.SubSubjects || []).filter((sub) =>
          (sub.subject_name || "").toLowerCase().includes(term)
        );
        if (parentMatches) return subject;
        if (matchingSubs.length > 0) {
          return { ...subject, SubSubjects: matchingSubs };
        }
        return null;
      })
      .filter(Boolean);
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
    setSelectedSubjectIds([]);
    setSubjectSearchTerm("");
    Modal.getOrCreateInstance(modalRef.current).show();

    // Pre-fill Course Code with the next number in sequence so admin
    // doesn't have to type it — still editable if they want a different one.
    API.get("/courses/next-code")
      .then((response) => {
        setFormData((prev) => ({ ...prev, course_code: response.data.data.next_code }));
      })
      .catch(() => {
        // Non-critical — admin can still type the code manually.
      });
  };

  const openEditModal = (course) => {
    setEditingId(course.id);
    setFormData({
      course_code: course.course_code || "",
      course_name: course.course_name || "",
      category: course.category || "",
      description: course.description || "",
      level: course.level || "",
      project: course.project || "",
      status: course.status || "Active",
      duration: course.duration || "",
      standard_fee: course.standard_fee || "",
      timings: course.timings || "",
      total_seats: course.total_seats || "",
    });
    setFormErrors({});
    setSelectedSubjectIds((course.Subjects || []).map((s) => s.id));
    setSubjectSearchTerm("");
    Modal.getOrCreateInstance(modalRef.current).show();
  };

  const toggleSubjectSelection = (subjectId) => {
    setSelectedSubjectIds((prev) =>
      prev.includes(subjectId)
        ? prev.filter((id) => id !== subjectId)
        : [...prev, subjectId]
    );
  };

  const toggleFullSubjectSelection = (subjectId) => {
    const fullSubject = subjects.find((s) => s.id === subjectId);
    const groupIds = [
      subjectId,
      ...(fullSubject?.SubSubjects || []).map((sub) => sub.id),
    ];
    setSelectedSubjectIds((prev) =>
      prev.includes(subjectId)
        ? prev.filter((id) => !groupIds.includes(id))
        : [...new Set([...prev, ...groupIds])]
    );
  };

  const openViewModal = (course) => {
    setViewCourse(course);
    Modal.getOrCreateInstance(viewModalRef.current).show();
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

  const validate = () => {
    const errors = {};
    if (!formData.course_name.trim()) {
      errors.course_name = "Course Name is required.";
    }
    if (formData.standard_fee !== "" && Number(formData.standard_fee) < 0) {
      errors.standard_fee = "Fee cannot be negative.";
    }
    if (formData.total_seats !== "" && Number(formData.total_seats) <= 0) {
      errors.total_seats = "Seats must be greater than zero.";
    }
    if (
      formData.course_code &&
      courses.some(
        (c) =>
          c.course_code &&
          c.course_code.toLowerCase() === formData.course_code.toLowerCase() &&
          c.id !== editingId
      )
    ) {
      errors.course_code = "This Course Code is already in use.";
    }
    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setSubmitting(true);
    try {
      const response = editingId
        ? await API.put(`/courses/${editingId}`, formData)
        : await API.post("/courses", formData);
      const courseId = editingId || response.data.data.id;
      await API.put(`/courses/${courseId}/subjects`, {
        subject_ids: selectedSubjectIds,
      });
      closeModal();
      await fetchCourses();
      setToast({
        variant: "success",
        message: response.data.message || "Course saved successfully",
      });
    } catch (err) {
      const field = err.response?.data?.field;
      const message = err.response?.data?.message;
      const serverErrors = err.response?.data?.errors;
      if (serverErrors) {
        setFormErrors(serverErrors);
      } else if (field) {
        setFormErrors({ [field]: message });
      } else {
        setToast({
          variant: "danger",
          message: message || "Failed to save course.",
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
      await API.delete(`/courses/${pendingDeleteId}`);
      Modal.getOrCreateInstance(deleteModalRef.current).hide();
      await fetchCourses();
      setToast({ variant: "success", message: "Course removed successfully" });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to delete course.",
      });
    }
  };

  const exportToExcel = () => {
    const data = sortedCourses.map((row) => {
      const record = {};
      EXPORT_COLUMNS.forEach((col) => {
        record[col.label] = row[col.key] ?? "";
      });
      return record;
    });
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Courses");
    XLSX.writeFile(workbook, "course_list.xlsx");
  };

  const exportToPDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    const head = [EXPORT_COLUMNS.map((col) => col.label)];
    const body = sortedCourses.map((row) =>
      EXPORT_COLUMNS.map((col) => (row[col.key] ?? "-").toString())
    );
    autoTable(doc, {
      head,
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [29, 78, 216] },
    });
    doc.save("course_list.pdf");
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
                Total Courses
              </div>
              <div className="fs-3 fw-bold text-primary">{summary.total}</div>
            </div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card shadow-sm h-100">
            <div className="card-body text-center">
              <div className="text-muted small text-uppercase fw-bold">
                Active Courses
              </div>
              <div className="fs-3 fw-bold text-success">{summary.active}</div>
            </div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card shadow-sm h-100">
            <div className="card-body text-center">
              <div className="text-muted small text-uppercase fw-bold">
                Total Seats
              </div>
              <div className="fs-3 fw-bold text-dark">{summary.totalSeats}</div>
            </div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card shadow-sm h-100">
            <div className="card-body text-center">
              <div className="text-muted small text-uppercase fw-bold">
                Available Seats
              </div>
              <div className="fs-3 fw-bold text-info">
                {summary.availableSeats}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card shadow-sm">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
            <h4 className="mb-0">Course Management</h4>
            <div className="d-flex gap-2 flex-wrap">
              <Link
                to="/courses/inactive"
                className="btn btn-outline-secondary btn-sm"
              >
                <i className="bi bi-archive me-1"></i> Inactive Courses
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
                className="btn btn-outline-dark btn-sm"
                onClick={() => window.print()}
              >
                <i className="bi bi-printer me-1"></i> Print
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={openAddModal}
              >
                <i className="bi bi-plus-lg me-1"></i> Add Course
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
                  placeholder="Search by Course Name or Code..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
            <div className="col-6 col-md-2">
              <select
                className="form-select"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-2">
              <select
                className="form-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All Statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-2">
              <select
                className="form-select"
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
              >
                <option value="">All Levels</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-2">
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
                  <th role="button" onClick={() => handleSort("course_code")}>
                    Course Code{" "}
                    <i className={`bi ${sortIcon("course_code")}`}></i>
                  </th>
                  <th
                    role="button"
                    onClick={() => handleSort("course_name")}
                  >
                    Course Name{" "}
                    <i className={`bi ${sortIcon("course_name")}`}></i>
                  </th>
                  <th>Category</th>
                  <th>Project</th>
                  <th role="button" onClick={() => handleSort("duration")}>
                    Duration <i className={`bi ${sortIcon("duration")}`}></i>
                  </th>
                  <th
                    role="button"
                    onClick={() => handleSort("standard_fee")}
                  >
                    Standard Fee{" "}
                    <i className={`bi ${sortIcon("standard_fee")}`}></i>
                  </th>
                  <th>Timings</th>
                  <th
                    role="button"
                    onClick={() => handleSort("total_seats")}
                  >
                    Total Seats{" "}
                    <i className={`bi ${sortIcon("total_seats")}`}></i>
                  </th>
                  <th>Status</th>
                  <th>Enrolled Students</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedCourses.length === 0 ? (
                  <tr>
                    <td className="text-center text-muted py-4" colSpan={12}>
                      <i className="bi bi-inbox fs-3 d-block mb-2"></i>
                      No courses found.
                    </td>
                  </tr>
                ) : (
                  paginatedCourses.map((c, index) => (
                    <tr key={c.id}>
                      <td>{(currentPage - 1) * ROWS_PER_PAGE + index + 1}</td>
                      <td>{c.course_code || "-"}</td>
                      <td>{c.course_name}</td>
                      <td>{c.category || "-"}</td>
                      <td>{c.project || "-"}</td>
                      <td>{c.duration || "-"}</td>
                      <td>{c.standard_fee || "-"}</td>
                      <td>{c.timings || "-"}</td>
                      <td>{c.total_seats || "-"}</td>
                      <td>
                        <span
                          className={`badge ${STATUS_BADGE[c.status] || "bg-secondary"}`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td>
                        <span className="badge bg-info text-dark">
                          {getEnrolledStudents(c.course_name).length}
                        </span>
                      </td>
                      <td className="d-flex gap-2">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          title="View"
                          onClick={() => openViewModal(c)}
                        >
                          <i className="bi bi-eye"></i>
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          title="Edit"
                          onClick={() => openEditModal(c)}
                        >
                          <i className="bi bi-pencil"></i>
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          title="Delete"
                          onClick={() => confirmDelete(c.id)}
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
              {sortedCourses.length === 0
                ? 0
                : (currentPage - 1) * ROWS_PER_PAGE + 1}
              –
              {Math.min(currentPage * ROWS_PER_PAGE, sortedCourses.length)} of{" "}
              {sortedCourses.length} courses
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

      {courses.length > 0 && (
        <div className="row g-3 mt-1 mb-4">
          <div className="col-md-6">
            <div className="card shadow-sm h-100">
              <div className="card-body">
                <h5 className="mb-3">Students per Course</h5>
                <div
                  style={{
                    height: `${Math.max(courses.length * 28, 200)}px`,
                  }}
                >
                  <Bar
                    data={courseStudentChartData}
                    options={{
                      indexAxis: "y",
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                      },
                      scales: {
                        x: { beginAtZero: true, ticks: { precision: 0 } },
                      },
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="col-md-6">
            <div className="card shadow-sm h-100">
              <div className="card-body">
                <h5 className="mb-3">Teachers per Course</h5>
                <div
                  style={{
                    height: `${Math.max(courses.length * 28, 200)}px`,
                  }}
                >
                  <Bar
                    data={courseTeacherChartData}
                    options={{
                      indexAxis: "y",
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                      },
                      scales: {
                        x: { beginAtZero: true, ticks: { precision: 0 } },
                      },
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      <div className="modal fade" id="courseModal" tabIndex="-1" ref={modalRef}>
        <div className="modal-dialog modal-lg modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">
                {editingId ? "Edit Course" : "Add Course"}
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
                  <div className="col-md-4">
                    <label className="form-label">Course Code</label>
                    <input
                      type="text"
                      name="course_code"
                      className={`form-control ${formErrors.course_code ? "is-invalid" : ""}`}
                      value={formData.course_code}
                      onChange={handleChange}
                    />
                    {formErrors.course_code && (
                      <div className="invalid-feedback">
                        {formErrors.course_code}
                      </div>
                    )}
                  </div>
                  <div className="col-md-8">
                    <label className="form-label">Course Name</label>
                    <input
                      type="text"
                      name="course_name"
                      className={`form-control ${formErrors.course_name ? "is-invalid" : ""}`}
                      value={formData.course_name}
                      onChange={handleChange}
                    />
                    {formErrors.course_name && (
                      <div className="invalid-feedback">
                        {formErrors.course_name}
                      </div>
                    )}
                  </div>

                  <div className="col-md-4">
                    <label className="form-label">Category</label>
                    <input
                      type="text"
                      name="category"
                      className="form-control"
                      placeholder="e.g. Computer Course"
                      value={formData.category}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Project</label>
                    <input
                      type="text"
                      name="project"
                      className="form-control"
                      placeholder="Project for this course"
                      value={formData.project}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Course Level</label>
                    <select
                      name="level"
                      className="form-select"
                      value={formData.level}
                      onChange={handleChange}
                    >
                      <option value="">Select</option>
                      {LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Course Status</label>
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
                    <label className="form-label">Course Description</label>
                    <textarea
                      name="description"
                      className="form-control"
                      rows={3}
                      value={formData.description}
                      onChange={handleChange}
                    ></textarea>
                  </div>

                  <div className="col-md-6">
                    <label className="form-label">Duration</label>
                    <input
                      type="text"
                      name="duration"
                      className="form-control"
                      placeholder="e.g. 3 Months"
                      value={formData.duration}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Standard Fee</label>
                    <input
                      type="number"
                      name="standard_fee"
                      className={`form-control ${formErrors.standard_fee ? "is-invalid" : ""}`}
                      value={formData.standard_fee}
                      onChange={handleChange}
                    />
                    {formErrors.standard_fee && (
                      <div className="invalid-feedback">
                        {formErrors.standard_fee}
                      </div>
                    )}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Timings</label>
                    <input
                      type="text"
                      name="timings"
                      className="form-control"
                      placeholder="e.g. 10 AM - 12 PM"
                      value={formData.timings}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Total Seats</label>
                    <input
                      type="number"
                      name="total_seats"
                      className={`form-control ${formErrors.total_seats ? "is-invalid" : ""}`}
                      value={formData.total_seats}
                      onChange={handleChange}
                    />
                    {formErrors.total_seats && (
                      <div className="invalid-feedback">
                        {formErrors.total_seats}
                      </div>
                    )}
                  </div>

                  <div className="col-12">
                    <label className="form-label d-block">Subjects</label>
                    {subjects.length === 0 ? (
                      <div className="text-muted small">
                        No subjects added yet — go to Subject Management to
                        add some.
                      </div>
                    ) : (
                      <div className="border rounded p-2">
                        <div className="text-muted small mb-2">
                          Tick the whole subject to include all of its
                          sub-subjects, or tick just one specific
                          sub-subject.
                        </div>
                        <div className="input-group input-group-sm mb-2">
                          <span className="input-group-text bg-white">
                            <i className="bi bi-search"></i>
                          </span>
                          <input
                            type="text"
                            className="form-control"
                            placeholder="Search subject or sub-subject..."
                            value={subjectSearchTerm}
                            onChange={(e) =>
                              setSubjectSearchTerm(e.target.value)
                            }
                          />
                        </div>
                        {filteredSubjectOptions.length === 0 ? (
                          <div className="text-muted small">
                            No subjects match your search.
                          </div>
                        ) : (
                          filteredSubjectOptions.map((subject) => (
                          <div className="mb-2" key={subject.id}>
                            <div className="form-check">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                checked={selectedSubjectIds.includes(
                                  subject.id
                                )}
                                onChange={() =>
                                  toggleFullSubjectSelection(subject.id)
                                }
                              />
                              <label className="form-check-label fw-semibold">
                                {subject.subject_name}
                                {(subject.SubSubjects || []).length > 0 && (
                                  <span className="text-muted fw-normal small">
                                    {" "}
                                    (full subject — all sub-subjects)
                                  </span>
                                )}
                              </label>
                            </div>
                            {(subject.SubSubjects || []).length > 0 && (
                              <div className="row g-1 ms-4 mt-1">
                                {subject.SubSubjects.map((sub) => (
                                  <div className="col-md-6" key={sub.id}>
                                    <div className="form-check">
                                      <input
                                        className="form-check-input"
                                        type="checkbox"
                                        checked={selectedSubjectIds.includes(
                                          sub.id
                                        )}
                                        onChange={() =>
                                          toggleSubjectSelection(sub.id)
                                        }
                                      />
                                      <label className="form-check-label small">
                                        {sub.subject_name}
                                      </label>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          ))
                        )}
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
      <div className="modal fade" id="courseViewModal" tabIndex="-1" ref={viewModalRef}>
        <div className="modal-dialog modal-lg modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Course Details</h5>
              <button
                type="button"
                className="btn-close"
                data-bs-dismiss="modal"
              ></button>
            </div>
            <div className="modal-body">
              {viewCourse && (
                <div className="row g-3">
                  {EXPORT_COLUMNS.map((col) => (
                    <div className="col-md-4" key={col.key}>
                      <div className="text-muted small fw-bold text-uppercase">
                        {col.label}
                      </div>
                      <div>{viewCourse[col.key] || "-"}</div>
                    </div>
                  ))}
                  <div className="col-12">
                    <div className="text-muted small fw-bold text-uppercase">
                      Description
                    </div>
                    <div>{viewCourse.description || "-"}</div>
                  </div>
                  <div className="col-12">
                    <div className="text-muted small fw-bold text-uppercase">
                      Subjects
                    </div>
                    <div>
                      {(viewCourse.Subjects || []).length === 0
                        ? "-"
                        : viewCourse.Subjects.map((s) => (
                            <span
                              key={s.id}
                              className="badge bg-info text-dark me-1"
                            >
                              {s.subject_name}
                            </span>
                          ))}
                    </div>
                  </div>
                  <div className="col-12">
                    <div className="text-muted small fw-bold text-uppercase">
                      Teachers ({getTeachersForCourse(viewCourse.id).length})
                    </div>
                    {getTeachersForCourse(viewCourse.id).length === 0 ? (
                      <div className="text-muted mb-2">
                        No teacher assigned to this course yet.
                      </div>
                    ) : (
                      <div className="mb-2">
                        {getTeachersForCourse(viewCourse.id).map((t) => (
                          <span
                            key={t.id}
                            className="badge bg-success me-1"
                          >
                            {t.teacher_name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="col-12">
                    <div className="text-muted small fw-bold text-uppercase">
                      Enrolled Students (
                      {getEnrolledStudents(viewCourse.course_name).length})
                    </div>
                    {getEnrolledStudents(viewCourse.course_name).length ===
                    0 ? (
                      <div className="text-muted">
                        No admissions found for this course yet.
                      </div>
                    ) : (
                      <ol className="mb-0 ps-3">
                        {getEnrolledStudents(viewCourse.course_name).map(
                          (a) => (
                            <li key={a.id}>
                              {a.applicant_name}
                              {a.mobile_no && (
                                <span className="text-muted">
                                  {" "}
                                  — {a.mobile_no}
                                </span>
                              )}
                            </li>
                          )
                        )}
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
        id="courseDeleteModal"
        tabIndex="-1"
        ref={deleteModalRef}
      >
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Remove Course</h5>
              <button
                type="button"
                className="btn-close"
                data-bs-dismiss="modal"
              ></button>
            </div>
            <div className="modal-body">
              Are you sure you want to remove this course? It will be moved to
              Inactive Courses and can be restored later.
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

export default CourseManagement;
