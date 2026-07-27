import { useEffect, useRef, useState } from "react";
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

const HOURS = Array.from({ length: 12 }, (_, i) =>
  String(i + 1).padStart(2, "0")
);
const MINUTES = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, "0")
);

const SECTION_SHORT = {
  fast_track: "FT",
  normal_mwf: "NT-MWF",
  normal_tts: "NT-TTS",
  weekend: "WE",
};

// Parses "09:00 AM - 11:00 AM" style strings into minutes-since-midnight
// for the start time, just to sort timetable rows chronologically.
const timingStartMinutes = (timing) => {
  const match = (timing || "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const ampm = match[3] ? match[3].toUpperCase() : null;
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
};

// Builds the two-way weekly timetable (by subject, and by teacher) from
// whatever batches already exist — no separate data entry for this.
const buildTimetable = (batches) => {
  const active = batches.filter(
    (b) => b.active && b.timing && b.Subject && b.Teacher
  );
  const timings = [...new Set(active.map((b) => b.timing))].sort(
    (a, b) => timingStartMinutes(a) - timingStartMinutes(b)
  );
  const subjects = [...new Set(active.map((b) => b.Subject.subject_name))].sort();
  const teachers = [...new Set(active.map((b) => b.Teacher.teacher_name))].sort();

  const bySubject = {};
  const byTeacher = {};
  timings.forEach((t) => {
    bySubject[t] = {};
    byTeacher[t] = {};
  });

  active.forEach((b) => {
    const t = b.timing;
    const subject = b.Subject.subject_name;
    const teacher = b.Teacher.teacher_name;
    const code = SECTION_SHORT[b.section] || b.section;

    if (!bySubject[t][subject]) bySubject[t][subject] = [];
    bySubject[t][subject].push({ batchId: b.id, label: `${teacher} (${code})` });

    if (!byTeacher[t][teacher]) byTeacher[t][teacher] = [];
    byTeacher[t][teacher].push({ batchId: b.id, label: `${subject} (${code})` });
  });

  return { timings, subjects, teachers, bySubject, byTeacher };
};

function GroupManagement() {
  const [toast, setToast] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [holidayForm, setHolidayForm] = useState({ date: "", description: "" });
  const [teacherStatus, setTeacherStatus] = useState({
    available: [],
    nonAvailable: [],
  });

  // --- Concept 2: Section-based Batch scheduling ---
  const batchModalRef = useRef(null);
  const batchDeleteModalRef = useRef(null);
  const [batches, setBatches] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [batchEditingId, setBatchEditingId] = useState(null);
  const initialBatchForm = {
    batch_name: "",
    section: "",
    subject_id: "",
    sub_subject_id: "",
    startHour: "",
    startMinute: "",
    startPeriod: "",
    endHour: "",
    endMinute: "",
    endPeriod: "",
    num_days: "",
    teacher_id: "",
  };
  const [batchForm, setBatchForm] = useState(initialBatchForm);
  const [batchFormErrors, setBatchFormErrors] = useState({});
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchTeacherOptions, setBatchTeacherOptions] = useState([]);
  const [batchStudentOptions, setBatchStudentOptions] = useState([]);
  const [batchSelectedStudentIds, setBatchSelectedStudentIds] = useState([]);
  const [pendingBatchDeleteId, setPendingBatchDeleteId] = useState(null);
  const [subjectTeachersCache, setSubjectTeachersCache] = useState({});
  const [batchSubstituteForm, setBatchSubstituteForm] = useState({});
  const [batchSearchTerm, setBatchSearchTerm] = useState("");
  const [batchSortField, setBatchSortField] = useState("batch_name");
  const [batchSortOrder, setBatchSortOrder] = useState("asc");
  const [batchCurrentPage, setBatchCurrentPage] = useState(1);
  const BATCH_ROWS_PER_PAGE = 10;

  const SECTIONS = [
    { key: "fast_track", label: "Fast Track (Every Day)" },
    { key: "normal_mwf", label: "Normal Track (Mon/Wed/Fri)" },
    { key: "normal_tts", label: "Normal Track (Tue/Thu/Sat)" },
    { key: "weekend", label: "Weekend (Saturday)" },
  ];
  const SECTION_LABEL_BY_KEY = Object.fromEntries(
    SECTIONS.map((s) => [s.key, s.label])
  );

  // --- Admin: teacher-wise batch progress (all teachers) ---
  const [teacherProgress, setTeacherProgress] = useState([]);
  const [expandedProgressTeacherId, setExpandedProgressTeacherId] = useState(null);
  const [expandedProgressBatchId, setExpandedProgressBatchId] = useState(null);
  const [expandedSessionKey, setExpandedSessionKey] = useState(null);

  const fetchTeacherProgress = async () => {
    try {
      const response = await API.get("/batches/teacher-progress");
      setTeacherProgress(response.data.data);
    } catch {
      // Secondary feature; ignore failures silently.
    }
  };

  const teacherProgressGroups = Object.values(
    teacherProgress.reduce((acc, b) => {
      const key = b.teacher_id ?? "unassigned";
      if (!acc[key]) {
        acc[key] = {
          teacher_id: b.teacher_id,
          teacher_name: b.teacher_name || "Unassigned",
          batches: [],
        };
      }
      acc[key].batches.push(b);
      return acc;
    }, {})
  );

  // --- Admin: subject-wise completion chart (Completed vs Not Completed) ---
  const [subjectChart, setSubjectChart] = useState([]);
  const [chartDrilldown, setChartDrilldown] = useState(null);
  const [expandedDrilldownStudentKey, setExpandedDrilldownStudentKey] = useState(null);

  const fetchSubjectChart = async () => {
    try {
      const response = await API.get("/batches/subject-completion-chart");
      setSubjectChart(response.data.data);
    } catch {
      // Secondary feature; ignore failures silently.
    }
  };

  const filteredBatchesTable = batches.filter((b) => {
    if (!batchSearchTerm.trim()) return true;
    const term = batchSearchTerm.toLowerCase();
    if ((b.batch_name || "").toLowerCase().includes(term)) return true;
    if ((b.Teacher?.teacher_name || "").toLowerCase().includes(term)) return true;
    if ((b.Subject?.subject_name || "").toLowerCase().includes(term)) return true;
    return (SECTION_LABEL_BY_KEY[b.section] || "").toLowerCase().includes(term);
  });

  const sortedBatchesTable = [...filteredBatchesTable].sort((a, b) => {
    const valA =
      batchSortField === "teacher"
        ? a.Teacher?.teacher_name || ""
        : batchSortField === "subject"
          ? a.Subject?.subject_name || ""
          : a[batchSortField] ?? "";
    const valB =
      batchSortField === "teacher"
        ? b.Teacher?.teacher_name || ""
        : batchSortField === "subject"
          ? b.Subject?.subject_name || ""
          : b[batchSortField] ?? "";
    const result = valA.toString().localeCompare(valB.toString());
    return batchSortOrder === "asc" ? result : -result;
  });

  const batchTotalPages = Math.max(
    1,
    Math.ceil(sortedBatchesTable.length / BATCH_ROWS_PER_PAGE)
  );
  const paginatedBatchesTable = sortedBatchesTable.slice(
    (batchCurrentPage - 1) * BATCH_ROWS_PER_PAGE,
    batchCurrentPage * BATCH_ROWS_PER_PAGE
  );

  const handleBatchSort = (field) => {
    if (batchSortField === field) {
      setBatchSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setBatchSortField(field);
      setBatchSortOrder("asc");
    }
  };

  const batchSortIcon = (field) => {
    if (batchSortField !== field) return "bi-arrow-down-up text-muted";
    return batchSortOrder === "asc" ? "bi-sort-up" : "bi-sort-down";
  };

  const fetchBatches = async () => {
    try {
      const response = await API.get("/batches?active=true");
      setBatches(response.data.data);
      const subjectIds = [
        ...new Set(response.data.data.map((b) => b.subject_id).filter(Boolean)),
      ];
      const results = await Promise.all(
        subjectIds.map((id) =>
          API.get(`/batches/subject-teachers/${id}`)
            .then((res) => [id, res.data.data])
            .catch(() => [id, []])
        )
      );
      setSubjectTeachersCache((prev) => ({
        ...prev,
        ...Object.fromEntries(results),
      }));
    } catch {
      // Batch list is a secondary feature here; ignore failures silently.
    }
  };

  const assignSubstituteForBatch = async (batchId) => {
    const substituteTeacherId = batchSubstituteForm[batchId];
    if (!substituteTeacherId) {
      setToast({ variant: "danger", message: "Pick a substitute teacher first." });
      return;
    }
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const response = await API.put(`/batches/${batchId}/substitute`, {
        date: todayStr,
        substitute_teacher_id: substituteTeacherId,
      });
      setBatchSubstituteForm((prev) => {
        const next = { ...prev };
        delete next[batchId];
        return next;
      });
      await fetchBatches();
      setToast({ variant: "success", message: response.data.message });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to set substitute.",
      });
    }
  };

  const removeSubstituteForBatch = async (batchId) => {
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      await API.delete(`/batches/${batchId}/substitute`, {
        params: { date: todayStr },
      });
      await fetchBatches();
      setToast({
        variant: "success",
        message: "Substitute removed — original teacher continues.",
      });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to remove substitute.",
      });
    }
  };

  const fetchSubjects = async () => {
    try {
      const response = await API.get("/subjects?active=true");
      setSubjects(response.data.data);
    } catch {
      // Subject list is a secondary feature here; ignore failures silently.
    }
  };

  const selectedBatchSubject = subjects.find(
    (s) => String(s.id) === String(batchForm.subject_id)
  );
  const batchSubSubjects = selectedBatchSubject?.SubSubjects || [];
  const effectiveBatchSubjectId =
    batchForm.sub_subject_id || batchForm.subject_id;

  const batchTiming =
    batchForm.startHour &&
    batchForm.startMinute &&
    batchForm.startPeriod &&
    batchForm.endHour &&
    batchForm.endMinute &&
    batchForm.endPeriod
      ? `${batchForm.startHour}:${batchForm.startMinute} ${batchForm.startPeriod} - ${batchForm.endHour}:${batchForm.endMinute} ${batchForm.endPeriod}`
      : "";

  useEffect(() => {
    if (!effectiveBatchSubjectId) {
      setBatchTeacherOptions([]);
      return;
    }
    API.get(`/batches/subject-teachers/${effectiveBatchSubjectId}`)
      .then((res) => setBatchTeacherOptions(res.data.data))
      .catch(() => setBatchTeacherOptions([]));
  }, [effectiveBatchSubjectId]);

  useEffect(() => {
    if (!effectiveBatchSubjectId) {
      setBatchStudentOptions([]);
      return;
    }
    API.get("/batches/subject-students", {
      params: { subjectId: effectiveBatchSubjectId },
    })
      .then((res) => setBatchStudentOptions(res.data.data))
      .catch(() => setBatchStudentOptions([]));
  }, [effectiveBatchSubjectId]);

  const openAddBatchModal = () => {
    setBatchEditingId(null);
    setBatchForm(initialBatchForm);
    setBatchFormErrors({});
    setBatchSelectedStudentIds([]);
    Modal.getOrCreateInstance(batchModalRef.current).show();
  };

  const openEditBatchModal = (batch) => {
    setBatchEditingId(batch.id);
    const [start, end] = (batch.timing || "").split(" - ");
    const [sh, rest] = (start || "").split(":");
    const [sm, sp] = (rest || "").split(" ");
    const [eh, restE] = (end || "").split(":");
    const [em, ep] = (restE || "").split(" ");
    const parentSubject = subjects.find((s) =>
      (s.SubSubjects || []).some((sub) => sub.id === batch.Subject?.id)
    );
    setBatchForm({
      batch_name: batch.batch_name || "",
      section: batch.section || "",
      subject_id: parentSubject ? String(parentSubject.id) : String(batch.subject_id),
      sub_subject_id: parentSubject ? String(batch.subject_id) : "",
      startHour: sh || "",
      startMinute: sm || "",
      startPeriod: sp || "",
      endHour: eh || "",
      endMinute: em || "",
      endPeriod: ep || "",
      num_days: batch.num_days ?? "",
      teacher_id: String(batch.teacher_id || ""),
    });
    setBatchFormErrors({});
    setBatchSelectedStudentIds((batch.Students || []).map((s) => s.id));
    Modal.getOrCreateInstance(batchModalRef.current).show();
  };

  const closeBatchModal = () => {
    Modal.getOrCreateInstance(batchModalRef.current).hide();
  };

  const handleBatchFormChange = (e) => {
    const { name, value } = e.target;
    setBatchForm((prev) => ({
      ...prev,
      [name]: value,
      ...(name === "subject_id" ? { sub_subject_id: "", teacher_id: "" } : {}),
      ...(name === "sub_subject_id" ? { teacher_id: "" } : {}),
    }));
    setBatchFormErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const toggleBatchStudentSelection = (admissionId) => {
    setBatchSelectedStudentIds((prev) =>
      prev.includes(admissionId)
        ? prev.filter((id) => id !== admissionId)
        : [...prev, admissionId]
    );
  };

  const submitBatch = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!batchForm.batch_name.trim()) errors.batch_name = "Batch Name is required.";
    if (!batchForm.section) errors.section = "Section is required.";
    if (!batchForm.subject_id) errors.subject_id = "Subject is required.";
    if (batchSubSubjects.length > 0 && !batchForm.sub_subject_id)
      errors.sub_subject_id = "Sub-Subject is required.";
    if (!batchForm.teacher_id) errors.teacher_id = "Teacher is required.";
    if (!batchTiming) errors.timing = "Start Time and End Time are required.";
    if (Object.keys(errors).length > 0) {
      setBatchFormErrors(errors);
      return;
    }

    setBatchSubmitting(true);
    try {
      const payload = {
        batch_name: batchForm.batch_name,
        section: batchForm.section,
        subject_id: effectiveBatchSubjectId,
        teacher_id: batchForm.teacher_id,
        timing: batchTiming,
        num_days: batchForm.num_days,
        admission_ids: batchSelectedStudentIds,
      };
      if (batchEditingId) {
        await API.put(`/batches/${batchEditingId}`, payload);
      } else {
        await API.post("/batches", payload);
      }
      closeBatchModal();
      await fetchBatches();
      setToast({ variant: "success", message: "Batch saved successfully" });
    } catch (err) {
      const serverErrors = err.response?.data?.errors;
      if (serverErrors) {
        setBatchFormErrors(serverErrors);
      } else {
        setToast({
          variant: "danger",
          message: err.response?.data?.message || "Failed to save batch.",
        });
      }
    } finally {
      setBatchSubmitting(false);
    }
  };

  const confirmDeleteBatch = (id) => {
    setPendingBatchDeleteId(id);
    Modal.getOrCreateInstance(batchDeleteModalRef.current).show();
  };

  const handleDeleteBatch = async () => {
    try {
      await API.delete(`/batches/${pendingBatchDeleteId}`);
      Modal.getOrCreateInstance(batchDeleteModalRef.current).hide();
      await fetchBatches();
      setToast({ variant: "success", message: "Batch removed successfully" });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to delete batch.",
      });
    }
  };

  const [draggedBatchId, setDraggedBatchId] = useState(null);
  const [dragOverSection, setDragOverSection] = useState(null);

  const moveBatchToSection = async (batchId, newSection) => {
    try {
      await API.patch(`/batches/${batchId}/section`, { section: newSection });
      await fetchBatches();
      setToast({ variant: "success", message: "Batch moved successfully" });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to move batch.",
      });
    }
  };

  const fetchHolidays = async () => {
    try {
      const response = await API.get("/holidays");
      setHolidays(response.data.data);
    } catch {
      // Holiday list is a secondary feature here; ignore failures silently.
    }
  };

  const fetchTeacherStatus = async () => {
    try {
      const response = await API.get("/teacher-availability/today");
      setTeacherStatus(response.data.data);
    } catch {
      // Teacher availability list is a secondary feature here; ignore failures silently.
    }
  };

  useEffect(() => {
    fetchHolidays();
    fetchTeacherStatus();
    fetchBatches();
    fetchSubjects();
    fetchTeacherProgress();
    fetchSubjectChart();
  }, []);

  useEffect(() => {
    setBatchCurrentPage(1);
  }, [batchSearchTerm, batchSortField, batchSortOrder]);

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
    const batchModalEl = batchModalRef.current;
    const batchDeleteModalEl = batchDeleteModalRef.current;
    if (!batchModalEl || !batchDeleteModalEl) return;
    const allModals = [batchModalEl, batchDeleteModalEl];
    allModals.forEach((el) => el.addEventListener("hidden.bs.modal", forceCleanup));
    return () => {
      allModals.forEach((el) =>
        el.removeEventListener("hidden.bs.modal", forceCleanup)
      );
    };
  }, []);


  const nonAvailableTeacherIds = new Set(
    teacherStatus.nonAvailable.map((t) => t.id)
  );

  const addHoliday = async () => {
    if (!holidayForm.date) {
      setToast({ variant: "danger", message: "Select a date first." });
      return;
    }
    try {
      await API.post("/holidays", holidayForm);
      setHolidayForm({ date: "", description: "" });
      await fetchHolidays();
      setToast({ variant: "success", message: "Holiday added successfully" });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to add holiday.",
      });
    }
  };

  const deleteHoliday = async (id) => {
    if (!window.confirm("Remove this holiday?")) return;
    try {
      await API.delete(`/holidays/${id}`);
      await fetchHolidays();
      setToast({ variant: "success", message: "Holiday removed successfully" });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to delete holiday.",
      });
    }
  };

  const timetable = buildTimetable(batches);

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

        <div className="card shadow-sm">
          <div className="card-body">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
              <h4 className="mb-0">Batch Scheduling — by Section</h4>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={openAddBatchModal}
              >
                <i className="bi bi-plus-lg me-1"></i> Add Batch
              </button>
            </div>

            <div className="row g-3">
              {SECTIONS.map((section) => {
                const sectionBatches = batches.filter(
                  (b) => b.section === section.key
                );
                return (
                  <div className="col-md-6 col-lg-3" key={section.key}>
                    <div
                      className={`border rounded p-2 h-100 ${dragOverSection === section.key ? "border-primary border-2 bg-light" : ""}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverSection(section.key);
                      }}
                      onDragLeave={() => setDragOverSection(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverSection(null);
                        if (draggedBatchId) {
                          moveBatchToSection(draggedBatchId, section.key);
                        }
                        setDraggedBatchId(null);
                      }}
                    >
                      <h6 className="mb-2">{section.label}</h6>
                      {sectionBatches.length === 0 ? (
                        <div className="text-muted small">No batches yet.</div>
                      ) : (
                        sectionBatches.map((b) => (
                          <div
                            key={b.id}
                            draggable
                            onDragStart={() => setDraggedBatchId(b.id)}
                            onDragEnd={() => setDraggedBatchId(null)}
                            className="border rounded p-2 mb-2 small bg-light"
                            style={{ cursor: "grab" }}
                          >
                            <div className="fw-semibold">
                              {b.batch_name}
                              {b.section_active_today && b.BatchSession?.ended_at && (
                                <span className="badge bg-secondary ms-2">
                                  <i className="bi bi-check-circle me-1"></i>
                                  Class Completed
                                </span>
                              )}
                              {b.section_active_today &&
                                b.BatchSession?.started_at &&
                                !b.BatchSession?.ended_at && (
                                  <span className="ms-2" title="Class in progress">
                                    <span
                                      className="d-inline-block rounded-circle bg-success"
                                      style={{ width: "8px", height: "8px" }}
                                    ></span>
                                    <span className="text-success small ms-1">Live</span>
                                  </span>
                                )}
                            </div>
                            <div className="text-muted">
                              {b.Subject?.subject_name || "-"}
                            </div>
                            <div>{b.Teacher?.teacher_name || "-"}</div>
                            <div>{b.timing}</div>
                            <div className="text-muted">
                              {b.num_days ? `${b.num_days} days` : ""}
                            </div>
                            <span className="badge bg-warning text-dark">
                              {(b.Students || []).length} students
                            </span>

                            {b.Substitutions?.[0] ? (
                              <div className="alert alert-warning py-1 px-2 mt-1 mb-1 small">
                                <i className="bi bi-exclamation-triangle me-1"></i>
                                Substitute teacher set:{" "}
                                <strong>
                                  {b.Substitutions[0].SubstituteTeacher?.teacher_name}
                                </strong>{" "}
                                (today only)
                                <button
                                  type="button"
                                  className="btn btn-sm btn-link text-danger p-0 ms-2"
                                  onClick={() => removeSubstituteForBatch(b.id)}
                                >
                                  Remove
                                </button>
                              </div>
                            ) : (
                              b.section_active_today &&
                              nonAvailableTeacherIds.has(b.teacher_id) && (
                                <div className="mt-1">
                                  <div className="text-danger small">
                                    <i className="bi bi-person-x me-1"></i>
                                    {b.Teacher?.teacher_name} is not available today.
                                  </div>
                                  <div className="d-flex gap-1 mt-1">
                                    <select
                                      className="form-select form-select-sm"
                                      value={batchSubstituteForm[b.id] || ""}
                                      onChange={(e) =>
                                        setBatchSubstituteForm((prev) => ({
                                          ...prev,
                                          [b.id]: e.target.value,
                                        }))
                                      }
                                    >
                                      <option value="">-- Pick substitute --</option>
                                      {(subjectTeachersCache[b.subject_id] || [])
                                        .filter(
                                          (t) =>
                                            t.id !== b.teacher_id &&
                                            !nonAvailableTeacherIds.has(t.id)
                                        )
                                        .map((t) => (
                                          <option key={t.id} value={t.id}>
                                            {t.teacher_name}
                                          </option>
                                        ))}
                                    </select>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-warning text-nowrap"
                                      onClick={() => assignSubstituteForBatch(b.id)}
                                    >
                                      Assign
                                    </button>
                                  </div>
                                </div>
                              )
                            )}

                            <div className="d-flex gap-1 mt-1">
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-primary"
                                onClick={() => openEditBatchModal(b)}
                              >
                                <i className="bi bi-pencil"></i>
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-danger"
                                onClick={() => confirmDeleteBatch(b.id)}
                              >
                                <i className="bi bi-trash"></i>
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="card shadow-sm mt-4">
          <div className="card-body">
            <h4 className="mb-3">Weekly Timetable — By Subject</h4>
            {timetable.timings.length === 0 ? (
              <div className="text-muted small">
                No active batches with a timing set yet.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-bordered table-sm align-middle text-center mb-0">
                  <thead className="table-primary">
                    <tr>
                      <th>Time</th>
                      {timetable.subjects.map((subject) => (
                        <th key={subject}>{subject}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {timetable.timings.map((t) => (
                      <tr key={t}>
                        <td className="fw-semibold">{t}</td>
                        {timetable.subjects.map((subject) => {
                          const cells = timetable.bySubject[t][subject] || [];
                          return (
                            <td key={subject}>
                              {cells.length === 0
                                ? "-"
                                : cells.map((c) => (
                                    <div key={c.batchId} className="small">
                                      {c.label}
                                    </div>
                                  ))}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="card shadow-sm mt-4">
          <div className="card-body">
            <h4 className="mb-3">Weekly Timetable — By Teacher</h4>
            {timetable.timings.length === 0 ? (
              <div className="text-muted small">
                No active batches with a timing set yet.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-bordered table-sm align-middle text-center mb-0">
                  <thead className="table-primary">
                    <tr>
                      <th>Time</th>
                      {timetable.teachers.map((teacher) => (
                        <th key={teacher}>{teacher}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {timetable.timings.map((t) => (
                      <tr key={t}>
                        <td className="fw-semibold">{t}</td>
                        {timetable.teachers.map((teacher) => {
                          const cells = timetable.byTeacher[t][teacher] || [];
                          return (
                            <td key={teacher}>
                              {cells.length === 0
                                ? "-"
                                : cells.map((c) => (
                                    <div key={c.batchId} className="small">
                                      {c.label}
                                    </div>
                                  ))}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="card shadow-sm mt-4">
          <div className="card-body">
            <h4 className="mb-3">All Batches</h4>
            <div className="input-group mb-3" style={{ maxWidth: "350px" }}>
              <span className="input-group-text bg-white">
                <i className="bi bi-search"></i>
              </span>
              <input
                type="text"
                className="form-control"
                placeholder="Search by Batch Name, Teacher, Subject, or Section..."
                value={batchSearchTerm}
                onChange={(e) => setBatchSearchTerm(e.target.value)}
              />
            </div>
            <div className="table-responsive">
              <table className="table table-striped table-hover align-middle">
                <thead className="table-primary">
                  <tr>
                    <th>#</th>
                    <th role="button" onClick={() => handleBatchSort("batch_name")}>
                      Batch Name <i className={`bi ${batchSortIcon("batch_name")}`}></i>
                    </th>
                    <th role="button" onClick={() => handleBatchSort("subject")}>
                      Subject <i className={`bi ${batchSortIcon("subject")}`}></i>
                    </th>
                    <th role="button" onClick={() => handleBatchSort("teacher")}>
                      Teacher <i className={`bi ${batchSortIcon("teacher")}`}></i>
                    </th>
                    <th role="button" onClick={() => handleBatchSort("section")}>
                      Section <i className={`bi ${batchSortIcon("section")}`}></i>
                    </th>
                    <th>Timing</th>
                    <th>Students</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedBatchesTable.length === 0 ? (
                    <tr>
                      <td className="text-center text-muted py-4" colSpan={8}>
                        <i className="bi bi-inbox fs-3 d-block mb-2"></i>
                        No batches found.
                      </td>
                    </tr>
                  ) : (
                    paginatedBatchesTable.map((b, index) => (
                      <tr key={b.id}>
                        <td>{(batchCurrentPage - 1) * BATCH_ROWS_PER_PAGE + index + 1}</td>
                        <td>{b.batch_name}</td>
                        <td>{b.Subject?.subject_name || "-"}</td>
                        <td>{b.Teacher?.teacher_name || "-"}</td>
                        <td>
                          <span className="badge bg-info text-dark">
                            {SECTION_LABEL_BY_KEY[b.section] || b.section}
                          </span>
                        </td>
                        <td>{b.timing}</td>
                        <td>
                          <span className="badge bg-warning text-dark">
                            {(b.Students || []).length}
                          </span>
                        </td>
                        <td className="d-flex gap-2">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary"
                            title="Edit"
                            onClick={() => openEditBatchModal(b)}
                          >
                            <i className="bi bi-pencil"></i>
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            title="Delete"
                            onClick={() => confirmDeleteBatch(b.id)}
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
                {sortedBatchesTable.length === 0
                  ? 0
                  : (batchCurrentPage - 1) * BATCH_ROWS_PER_PAGE + 1}
                –
                {Math.min(batchCurrentPage * BATCH_ROWS_PER_PAGE, sortedBatchesTable.length)} of{" "}
                {sortedBatchesTable.length} batches
              </span>
              <nav>
                <ul className="pagination pagination-sm mb-0">
                  <li className={`page-item ${batchCurrentPage === 1 ? "disabled" : ""}`}>
                    <button
                      className="page-link"
                      onClick={() => setBatchCurrentPage((p) => Math.max(1, p - 1))}
                    >
                      « Previous
                    </button>
                  </li>
                  {Array.from({ length: batchTotalPages }, (_, i) => i + 1).map((page) => (
                    <li
                      key={page}
                      className={`page-item ${batchCurrentPage === page ? "active" : ""}`}
                    >
                      <button
                        className="page-link"
                        onClick={() => setBatchCurrentPage(page)}
                      >
                        {page}
                      </button>
                    </li>
                  ))}
                  <li
                    className={`page-item ${batchCurrentPage === batchTotalPages ? "disabled" : ""}`}
                  >
                    <button
                      className="page-link"
                      onClick={() =>
                        setBatchCurrentPage((p) => Math.min(batchTotalPages, p + 1))
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

        <div className="card shadow-sm mt-4">
          <div className="card-body">
            <h4 className="mb-3">Batch Progress — Teacher Wise</h4>
            {teacherProgressGroups.length === 0 ? (
              <div className="text-muted small">No batches yet.</div>
            ) : (
              teacherProgressGroups.map((tg) => {
                const teacherKey = tg.teacher_id ?? "unassigned";
                const isTeacherOpen = expandedProgressTeacherId === teacherKey;
                return (
                  <div key={teacherKey} className="border rounded p-3 mb-2">
                    <div
                      role="button"
                      className="d-flex justify-content-between align-items-center"
                      onClick={() =>
                        setExpandedProgressTeacherId(
                          isTeacherOpen ? null : teacherKey
                        )
                      }
                    >
                      <div>
                        <strong>{tg.teacher_name}</strong>
                        <span className="text-muted small ms-2">
                          {tg.batches.length} batch
                          {tg.batches.length === 1 ? "" : "es"}
                        </span>
                      </div>
                      <i
                        className={`bi ${isTeacherOpen ? "bi-chevron-up" : "bi-chevron-down"} text-muted`}
                      ></i>
                    </div>

                    {isTeacherOpen && (
                      <div className="mt-3">
                        {tg.batches.map((bp) => {
                          const isOpen = expandedProgressBatchId === bp.id;
                          return (
                            <div key={bp.id} className="border rounded p-3 mb-2 bg-light-subtle">
                              <div
                                role="button"
                                className="d-flex justify-content-between align-items-center flex-wrap gap-2"
                                onClick={() =>
                                  setExpandedProgressBatchId(isOpen ? null : bp.id)
                                }
                              >
                                <div>
                                  <strong>{bp.batch_name}</strong>
                                  <span className="text-muted small ms-2">
                                    {bp.subject_name}
                                  </span>
                                  <span className="badge bg-info text-dark ms-2">
                                    {bp.section_label}
                                  </span>
                                  <div className="text-muted small">
                                    <i className="bi bi-clock me-1"></i>
                                    {bp.timing || "No timing set"}
                                    {" — "}
                                    {bp.students.length} student
                                    {bp.students.length === 1 ? "" : "s"}
                                  </div>
                                  {bp.num_days != null && (
                                    <div className="small mt-1">
                                      <span
                                        className={`badge ${
                                          bp.isOverdue
                                            ? "bg-danger"
                                            : bp.isNearingDeadline
                                              ? "bg-warning text-dark"
                                              : "bg-secondary"
                                        }`}
                                      >
                                        {bp.daysCompleted} of {bp.num_days} days completed
                                      </span>
                                      {bp.isOverdue && (
                                        <span className="text-danger small ms-2">
                                          <i className="bi bi-exclamation-triangle me-1"></i>
                                          Overdue — this batch has gone past its {bp.num_days}-day target.
                                        </span>
                                      )}
                                      {!bp.isOverdue && bp.isNearingDeadline && (
                                        <span className="text-warning small ms-2">
                                          <i className="bi bi-exclamation-circle me-1"></i>
                                          Only {bp.daysRemaining} day{bp.daysRemaining === 1 ? "" : "s"} left to finish the syllabus.
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                                <i
                                  className={`bi ${isOpen ? "bi-chevron-up" : "bi-chevron-down"} text-muted`}
                                ></i>
                              </div>

                              {isOpen && (
                                <div className="mt-3">
                                  <div className="fw-semibold small mb-2">
                                    Covered Topics ({bp.sessions.length})
                                  </div>
                                  {bp.sessions.length === 0 ? (
                                    <div className="text-muted small">
                                      No topics recorded for this batch yet.
                                    </div>
                                  ) : (
                                    bp.sessions.map((s) => {
                                      const sessionKey = `${bp.id}-${s.date}`;
                                      const isSessionOpen =
                                        expandedSessionKey === sessionKey;
                                      return (
                                        <div
                                          key={sessionKey}
                                          className="border rounded p-2 mb-2 bg-white"
                                        >
                                          <div
                                            role="button"
                                            className="d-flex justify-content-between align-items-center"
                                            onClick={() =>
                                              setExpandedSessionKey(
                                                isSessionOpen ? null : sessionKey
                                              )
                                            }
                                          >
                                            <div>
                                              <span className="fw-semibold small">
                                                {s.date}
                                              </span>
                                              <span className="text-muted small ms-2">
                                                {s.topic_covered}
                                              </span>
                                            </div>
                                            <div className="d-flex align-items-center gap-2">
                                              <span className="badge bg-success">
                                                {s.presentCount} present
                                              </span>
                                              <span className="badge bg-danger">
                                                {s.absentCount} absent
                                              </span>
                                              <i
                                                className={`bi ${isSessionOpen ? "bi-chevron-up" : "bi-chevron-down"} text-muted`}
                                              ></i>
                                            </div>
                                          </div>
                                          {isSessionOpen && (
                                            <div className="row g-2 mt-2">
                                              <div className="col-md-6">
                                                <div className="text-success small fw-semibold mb-1">
                                                  Present ({s.presentCount})
                                                </div>
                                                {s.present.length === 0 ? (
                                                  <div className="text-muted small">None</div>
                                                ) : (
                                                  s.present.map((st) => (
                                                    <div key={st.id} className="small">
                                                      {st.applicant_name}
                                                      {st.comn_enrol_no && (
                                                        <span className="text-muted"> ({st.comn_enrol_no})</span>
                                                      )}
                                                    </div>
                                                  ))
                                                )}
                                              </div>
                                              <div className="col-md-6">
                                                <div className="text-danger small fw-semibold mb-1">
                                                  Absent ({s.absentCount})
                                                </div>
                                                {s.absent.length === 0 ? (
                                                  <div className="text-muted small">None</div>
                                                ) : (
                                                  s.absent.map((st) => (
                                                    <div key={st.id} className="small">
                                                      {st.applicant_name}
                                                      {st.comn_enrol_no && (
                                                        <span className="text-muted"> ({st.comn_enrol_no})</span>
                                                      )}
                                                    </div>
                                                  ))
                                                )}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="card shadow-sm mt-4">
          <div className="card-body">
            <h4 className="mb-3">Subject-wise Completion — Students</h4>
            {subjectChart.length === 0 ? (
              <div className="text-muted small">
                No batches with a day-target (num_days) set yet.
              </div>
            ) : (
              <>
                <div style={{ maxWidth: "700px" }}>
                  <Bar
                    data={{
                      labels: subjectChart.map((s) => s.subject_name),
                      datasets: [
                        {
                          label: "Completed",
                          data: subjectChart.map((s) => s.completedCount),
                          backgroundColor: "#16a34a",
                          borderRadius: 4,
                        },
                        {
                          label: "Not Completed",
                          data: subjectChart.map((s) => s.notCompletedCount),
                          backgroundColor: "#dc2626",
                          borderRadius: 4,
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      onClick: (_event, elements) => {
                        if (!elements.length) return;
                        const { datasetIndex, index } = elements[0];
                        const subject = subjectChart[index];
                        const isCompleted = datasetIndex === 0;
                        setExpandedDrilldownStudentKey(null);
                        setChartDrilldown({
                          subject_name: subject.subject_name,
                          status: isCompleted ? "Completed" : "Not Completed",
                          students: isCompleted
                            ? subject.completedStudents
                            : subject.notCompletedStudents,
                        });
                      },
                      onHover: (event, elements) => {
                        event.native.target.style.cursor = elements.length
                          ? "pointer"
                          : "default";
                      },
                      plugins: {
                        legend: { position: "top" },
                        title: {
                          display: true,
                          text: "Completed vs Not Completed Students (per Subject)",
                        },
                      },
                      scales: {
                        y: { beginAtZero: true, ticks: { precision: 0 } },
                      },
                    }}
                  />
                </div>

                {chartDrilldown && (
                  <div className="border rounded p-3 mt-3">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <h6 className="mb-0">
                        {chartDrilldown.subject_name} —{" "}
                        <span
                          className={
                            chartDrilldown.status === "Completed"
                              ? "text-success"
                              : "text-danger"
                          }
                        >
                          {chartDrilldown.status}
                        </span>{" "}
                        ({chartDrilldown.students.length})
                      </h6>
                      <button
                        type="button"
                        className="btn-close"
                        onClick={() => setChartDrilldown(null)}
                      ></button>
                    </div>
                    {chartDrilldown.students.length === 0 ? (
                      <div className="text-muted small">No students in this group.</div>
                    ) : (
                      chartDrilldown.students.map((st) => {
                        const key = `${st.batch_id}-${st.id}`;
                        const isStudentOpen = expandedDrilldownStudentKey === key;
                        return (
                          <div key={key} className="border rounded p-2 mb-2">
                            <div
                              role="button"
                              className="d-flex justify-content-between align-items-center"
                              onClick={() =>
                                setExpandedDrilldownStudentKey(
                                  isStudentOpen ? null : key
                                )
                              }
                            >
                              <div className="small">
                                <strong>{st.applicant_name}</strong>
                                {st.comn_enrol_no && (
                                  <span className="text-muted"> ({st.comn_enrol_no})</span>
                                )}
                              </div>
                              <i
                                className={`bi ${isStudentOpen ? "bi-chevron-up" : "bi-chevron-down"} text-muted`}
                              ></i>
                            </div>
                            {isStudentOpen && (
                              <div className="small text-muted mt-2">
                                <div>
                                  <strong>Subject:</strong> {chartDrilldown.subject_name}
                                </div>
                                <div>
                                  <strong>Batch:</strong> {st.batch_name}
                                </div>
                                <div>
                                  <strong>Classes attended:</strong> {st.presentCount} of{" "}
                                  {st.num_days}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="card shadow-sm mt-4">
          <div className="card-body">
            <h4 className="mb-3">Today's Teacher Availability</h4>
            <div className="row g-3">
              <div className="col-md-6">
                <div className="fw-bold text-success mb-2">
                  <i className="bi bi-check-circle me-1"></i>
                  Available Today ({teacherStatus.available.length})
                </div>
                {teacherStatus.available.length === 0 ? (
                  <div className="text-muted small">No teachers found.</div>
                ) : (
                  <div className="d-flex flex-wrap gap-2">
                    {teacherStatus.available.map((t) => (
                      <span key={t.id} className="badge bg-success">
                        {t.teacher_name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="col-md-6">
                <div className="fw-bold text-danger mb-2">
                  <i className="bi bi-x-circle me-1"></i>
                  Not Available Today ({teacherStatus.nonAvailable.length})
                </div>
                {teacherStatus.nonAvailable.length === 0 ? (
                  <div className="text-muted small">Everyone is available today.</div>
                ) : (
                  <div className="d-flex flex-column gap-1">
                    {teacherStatus.nonAvailable.map((t) => (
                      <div key={t.id} className="small">
                        <span className="badge bg-danger me-1">{t.teacher_name}</span>
                        <span className="text-muted">{t.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="card shadow-sm mt-4">
          <div className="card-body">
            <h4 className="mb-3">Holidays</h4>
            <div className="text-muted small mb-3">
              Mark a date as a holiday — no batch classes can be started/ended that day.
            </div>
            <div className="row g-2 align-items-end mb-3">
              <div className="col-md-3">
                <label className="form-label small mb-1">Date</label>
                <input
                  type="date"
                  className="form-control form-control-sm"
                  value={holidayForm.date}
                  onChange={(e) =>
                    setHolidayForm((prev) => ({ ...prev, date: e.target.value }))
                  }
                />
              </div>
              <div className="col-md-5">
                <label className="form-label small mb-1">Description (optional)</label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="e.g. Diwali Holiday"
                  value={holidayForm.description}
                  onChange={(e) =>
                    setHolidayForm((prev) => ({ ...prev, description: e.target.value }))
                  }
                />
              </div>
              <div className="col-md-2">
                <button
                  type="button"
                  className="btn btn-primary btn-sm w-100"
                  onClick={addHoliday}
                >
                  Add Holiday
                </button>
              </div>
            </div>
            {holidays.length === 0 ? (
              <div className="text-muted small">No holidays marked yet.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm table-striped align-middle">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holidays.map((h) => (
                      <tr key={h.id}>
                        <td>{h.date}</td>
                        <td>{h.description || "-"}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => deleteHoliday(h.id)}
                          >
                            <i className="bi bi-trash"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

      {/* Add/Edit Batch Modal */}
      <div className="modal fade" tabIndex="-1" ref={batchModalRef}>
        <div className="modal-dialog modal-lg modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">
                {batchEditingId ? "Edit Batch" : "Add Batch"}
              </h5>
              <button type="button" className="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <form onSubmit={submitBatch}>
              <div className="modal-body" style={{ maxHeight: "70vh", overflowY: "auto" }}>
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label">Batch Name</label>
                    <input
                      type="text"
                      name="batch_name"
                      className={`form-control ${batchFormErrors.batch_name ? "is-invalid" : ""}`}
                      value={batchForm.batch_name}
                      onChange={handleBatchFormChange}
                    />
                    {batchFormErrors.batch_name && (
                      <div className="invalid-feedback">{batchFormErrors.batch_name}</div>
                    )}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Section</label>
                    <select
                      name="section"
                      className={`form-select ${batchFormErrors.section ? "is-invalid" : ""}`}
                      value={batchForm.section}
                      onChange={handleBatchFormChange}
                    >
                      <option value="">-- Select Section --</option>
                      {SECTIONS.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    {batchFormErrors.section && (
                      <div className="invalid-feedback">{batchFormErrors.section}</div>
                    )}
                  </div>

                  <div className="col-md-6">
                    <label className="form-label">Subject</label>
                    <select
                      name="subject_id"
                      className={`form-select ${batchFormErrors.subject_id ? "is-invalid" : ""}`}
                      value={batchForm.subject_id}
                      onChange={handleBatchFormChange}
                    >
                      <option value="">-- Select Subject --</option>
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.subject_name}
                        </option>
                      ))}
                    </select>
                    {batchFormErrors.subject_id && (
                      <div className="invalid-feedback">{batchFormErrors.subject_id}</div>
                    )}
                  </div>
                  {batchSubSubjects.length > 0 && (
                    <div className="col-md-6">
                      <label className="form-label">Sub-Subject</label>
                      <select
                        name="sub_subject_id"
                        className={`form-select ${batchFormErrors.sub_subject_id ? "is-invalid" : ""}`}
                        value={batchForm.sub_subject_id}
                        onChange={handleBatchFormChange}
                      >
                        <option value="">-- Select Sub-Subject --</option>
                        {batchSubSubjects.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.subject_name}
                          </option>
                        ))}
                      </select>
                      {batchFormErrors.sub_subject_id && (
                        <div className="invalid-feedback">{batchFormErrors.sub_subject_id}</div>
                      )}
                    </div>
                  )}

                  <div className="col-md-4">
                    <label className="form-label">Number of Days</label>
                    <input
                      type="number"
                      name="num_days"
                      min="1"
                      className="form-control"
                      placeholder="e.g. 5"
                      value={batchForm.num_days}
                      onChange={handleBatchFormChange}
                    />
                  </div>

                  <div className="col-12">
                    <label className="form-label">Start Time</label>
                    <div className="d-flex gap-1 mb-1">
                      <select
                        name="startHour"
                        className="form-select form-select-sm"
                        value={batchForm.startHour}
                        onChange={handleBatchFormChange}
                      >
                        <option value="">HH</option>
                        {HOURS.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                      <select
                        name="startMinute"
                        className="form-select form-select-sm"
                        value={batchForm.startMinute}
                        onChange={handleBatchFormChange}
                      >
                        <option value="">MM</option>
                        {MINUTES.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <select
                        name="startPeriod"
                        className="form-select form-select-sm"
                        value={batchForm.startPeriod}
                        onChange={handleBatchFormChange}
                      >
                        <option value="">--</option>
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                      </select>
                    </div>
                    <label className="form-label">End Time</label>
                    <div className="d-flex gap-1">
                      <select
                        name="endHour"
                        className="form-select form-select-sm"
                        value={batchForm.endHour}
                        onChange={handleBatchFormChange}
                      >
                        <option value="">HH</option>
                        {HOURS.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                      <select
                        name="endMinute"
                        className="form-select form-select-sm"
                        value={batchForm.endMinute}
                        onChange={handleBatchFormChange}
                      >
                        <option value="">MM</option>
                        {MINUTES.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <select
                        name="endPeriod"
                        className="form-select form-select-sm"
                        value={batchForm.endPeriod}
                        onChange={handleBatchFormChange}
                      >
                        <option value="">--</option>
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                      </select>
                    </div>
                    {batchFormErrors.timing && (
                      <div className="text-danger small mt-1">{batchFormErrors.timing}</div>
                    )}
                  </div>

                  <div className="col-12">
                    <label className="form-label">Teacher</label>
                    <select
                      name="teacher_id"
                      className={`form-select ${batchFormErrors.teacher_id ? "is-invalid" : ""}`}
                      value={batchForm.teacher_id}
                      onChange={handleBatchFormChange}
                      disabled={!effectiveBatchSubjectId}
                    >
                      <option value="">
                        {effectiveBatchSubjectId
                          ? "-- Select Teacher --"
                          : "Select a Subject first"}
                      </option>
                      {batchTeacherOptions.map((t) => (
                        <option key={t.id} value={t.id}>{t.teacher_name}</option>
                      ))}
                    </select>
                    {batchFormErrors.teacher_id && (
                      <div className="invalid-feedback">{batchFormErrors.teacher_id}</div>
                    )}
                    {effectiveBatchSubjectId && batchTeacherOptions.length === 0 && (
                      <div className="form-text text-warning">
                        No teacher is assigned (via Teacher Management) to a course whose
                        syllabus includes this subject.
                      </div>
                    )}
                  </div>

                  <div className="col-12">
                    <label className="form-label d-block">Students</label>
                    {!effectiveBatchSubjectId ? (
                      <div className="text-muted small">
                        Select a Subject — students admitted for a course whose
                        syllabus includes it will be suggested here.
                      </div>
                    ) : batchStudentOptions.length === 0 ? (
                      <div className="text-muted small">
                        No admitted students found for this subject.
                      </div>
                    ) : (
                      <div className="border rounded p-2 row g-2">
                        {batchStudentOptions.map((a) => (
                          <div className="col-md-4" key={a.id}>
                            <div className="form-check">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                checked={batchSelectedStudentIds.includes(a.id)}
                                onChange={() => toggleBatchStudentSelection(a.id)}
                              />
                              <label className="form-check-label">
                                {a.applicant_name}
                                {a.comn_enrol_no && (
                                  <span className="text-muted small"> ({a.comn_enrol_no})</span>
                                )}
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={batchSubmitting}>
                  {batchSubmitting ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* Delete Batch Confirmation Modal */}
      <div className="modal fade" tabIndex="-1" ref={batchDeleteModalRef}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Remove Batch</h5>
              <button type="button" className="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div className="modal-body">Are you sure you want to remove this batch?</div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={handleDeleteBatch}>
                Remove
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

export default GroupManagement;
