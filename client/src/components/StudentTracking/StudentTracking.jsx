import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import API from "../../api/api";
import StudentRiskManagement from "./StudentRiskManagement";
import StudentAppAttendance from "./StudentAppAttendance";

const EXPORT_COLUMNS = [
  { key: "applicant_name", label: "Student Name" },
  { key: "comn_enrol_no", label: "Enrol No" },
  { key: "subject_name", label: "Subject" },
  { key: "batch_name", label: "Batch" },
  { key: "teacher_name", label: "Teacher" },
  { key: "topic_completion", label: "Topic Completion" },
  { key: "batch_progress", label: "Batch Progress" },
  { key: "overall_attendance", label: "Overall Attendance %" },
  { key: "last_attended", label: "Last Attended" },
  { key: "total_fee", label: "Total Fee" },
  { key: "total_paid", label: "Paid" },
  { key: "balance", label: "Balance" },
  { key: "fee_status", label: "Fee Status" },
];

const ATTENDANCE_BUCKET = (percent) =>
  percent >= 75 ? "Good" : percent >= 50 ? "Warning" : "Low";

const FEE_BADGE_CLASS = {
  Paid: "text-bg-success",
  "Partially Paid": "text-bg-warning",
  Pending: "text-bg-danger",
  "Fee Not Set": "text-bg-secondary",
};

// Only the two "flagged" risk tiers need a banner here — an On Track
// student shows no banner at all. See server/utils/studentRisk.js for how
// riskStatus/riskReasons are computed.
const RISK_BADGE = {
  at_risk: { label: "At Risk", emoji: "🔴", alertClass: "alert-danger" },
  needs_attention: { label: "Needs Attention", emoji: "🟠", alertClass: "alert-warning" },
};

const formatMonthLabel = (yearMonth) => {
  const [y, m] = yearMonth.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
};

function StudentTracking() {
  const location = useLocation();
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [teacherFilter, setTeacherFilter] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [attendanceStatusFilter, setAttendanceStatusFilter] = useState("");
  const [feeStatusFilter, setFeeStatusFilter] = useState("");
  const [expandedStudentId, setExpandedStudentId] = useState(null);
  const [expandedSubjectKey, setExpandedSubjectKey] = useState(null);
  const [activeTab, setActiveTab] = useState("tracking");
  const [pendingScrollId, setPendingScrollId] = useState(null);
  const [crossPageNotice, setCrossPageNotice] = useState("");

  const handleOpenFromRisk = (id) => {
    setActiveTab("tracking");
    setExpandedStudentId(id);
    setPendingScrollId(id);
  };

  useEffect(() => {
    if (!pendingScrollId || activeTab !== "tracking") return;
    const el = document.getElementById(`tracking-card-${pendingScrollId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    setPendingScrollId(null);
  }, [pendingScrollId, activeTab]);

  // Cross-page open from Follow-Up Management's "View Student 360°" —
  // navigate(..., {state:{openStudentId}}) lands here. /batches/student-tracking
  // only returns students currently in an active batch, so a follow-up can
  // legitimately point at a student not present here — show a notice
  // instead of silently doing nothing.
  useEffect(() => {
    const targetId = location.state?.openStudentId;
    if (!targetId || loading) return;
    const found = students.some((s) => s.id === targetId);
    if (found) {
      handleOpenFromRisk(targetId);
    } else {
      setCrossPageNotice("This student has no active batch enrollment to show here yet.");
    }
    navigate(location.pathname, { replace: true, state: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, students]);

  useEffect(() => {
    const fetchTracking = async () => {
      try {
        const response = await API.get("/batches/student-tracking");
        setStudents(response.data.data);
        setError("");
      } catch (err) {
        setError(err.response?.data?.message || "Failed to load student tracking data.");
      } finally {
        setLoading(false);
      }
    };
    fetchTracking();
  }, []);

  const subjectOptions = useMemo(
    () =>
      [...new Set(students.flatMap((s) => s.subjects.map((sub) => sub.subject_name)))]
        .filter(Boolean)
        .sort(),
    [students]
  );
  const teacherOptions = useMemo(
    () =>
      [...new Set(students.flatMap((s) => s.subjects.map((sub) => sub.teacher_name)))]
        .filter(Boolean)
        .sort(),
    [students]
  );
  const batchOptions = useMemo(
    () =>
      [...new Set(students.flatMap((s) => s.subjects.map((sub) => sub.batch_name)))]
        .filter(Boolean)
        .sort(),
    [students]
  );

  const hasActiveSubjectFilters = subjectFilter || teacherFilter || batchFilter;
  const hasAnyFilter =
    searchTerm || hasActiveSubjectFilters || attendanceStatusFilter || feeStatusFilter;

  // Search + Attendance Status + Fee Status narrow which STUDENTS show up at
  // all (they're whole-student attributes). Subject/Teacher/Batch instead
  // narrow which of that student's enrollments are shown — a student stays
  // visible as long as at least one enrollment matches (or, with no
  // subject/teacher/batch filter active, everyone shows).
  const filteredStudents = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return students
      .filter((s) => {
        if (
          term &&
          !(s.applicant_name || "").toLowerCase().includes(term) &&
          !(s.comn_enrol_no || "").toLowerCase().includes(term)
        ) {
          return false;
        }
        if (
          attendanceStatusFilter &&
          ATTENDANCE_BUCKET(s.attendanceSummary.overallAttendancePercent) !==
            attendanceStatusFilter
        ) {
          return false;
        }
        if (feeStatusFilter && s.feeSummary.status !== feeStatusFilter) {
          return false;
        }
        return true;
      })
      .map((s) => {
        const subjects = s.subjects.filter(
          (sub) =>
            (!subjectFilter || sub.subject_name === subjectFilter) &&
            (!teacherFilter || sub.teacher_name === teacherFilter) &&
            (!batchFilter || sub.batch_name === batchFilter)
        );
        // The summary cards must reflect only what's currently shown —
        // recompute from the filtered subjects instead of trusting the
        // server's all-subjects totals, or the numbers won't match what's
        // visible on screen. Fee data is a whole-student attribute, not
        // per-subject, so it's left untouched (carried through via ...s).
        const attendanceSummary = hasActiveSubjectFilters
          ? (() => {
              const totalClasses = subjects.reduce((sum, sub) => sum + sub.totalTopics, 0);
              const present = subjects.reduce((sum, sub) => sum + sub.completedTopics.length, 0);
              const absent = subjects.reduce((sum, sub) => sum + sub.missedTopics.length, 0);
              const dates = subjects.flatMap((sub) => sub.completedTopics.map((t) => t.date));
              return {
                totalClasses,
                present,
                absent,
                overallAttendancePercent: totalClasses
                  ? Math.round((present / totalClasses) * 100)
                  : 0,
                lastAttendedDate: dates.length ? dates.sort().at(-1) : null,
              };
            })()
          : s.attendanceSummary;
        return { ...s, subjects, attendanceSummary };
      })
      .filter((s) => s.subjects.length > 0 || !hasActiveSubjectFilters);
  }, [
    students,
    searchTerm,
    subjectFilter,
    teacherFilter,
    batchFilter,
    attendanceStatusFilter,
    feeStatusFilter,
    hasActiveSubjectFilters,
  ]);

  const clearFilters = () => {
    setSearchTerm("");
    setSubjectFilter("");
    setTeacherFilter("");
    setBatchFilter("");
    setAttendanceStatusFilter("");
    setFeeStatusFilter("");
  };

  const exportRows = () =>
    filteredStudents.flatMap((s) => {
      const feeCols = {
        total_fee: s.feeSummary.totalFee != null ? s.feeSummary.totalFee : "-",
        total_paid: s.feeSummary.totalPaid,
        balance: s.feeSummary.balance != null ? s.feeSummary.balance : "-",
        fee_status: s.feeSummary.status,
      };
      return s.subjects.length === 0
        ? [
            {
              applicant_name: s.applicant_name,
              comn_enrol_no: s.comn_enrol_no,
              subject_name: "-",
              batch_name: "-",
              teacher_name: "-",
              topic_completion: "-",
              batch_progress: "-",
              overall_attendance: `${s.attendanceSummary.overallAttendancePercent}%`,
              last_attended: s.attendanceSummary.lastAttendedDate || "-",
              ...feeCols,
            },
          ]
        : s.subjects.map((sub) => ({
            applicant_name: s.applicant_name,
            comn_enrol_no: s.comn_enrol_no,
            subject_name: sub.subject_name,
            batch_name: sub.batch_name,
            teacher_name: sub.teacher_name || "-",
            topic_completion: `${sub.completedTopics.length}/${sub.totalTopics} (${sub.completionPercent}%)`,
            batch_progress:
              sub.numDays != null
                ? `${sub.daysCompleted}/${sub.numDays} (${sub.durationPercent}%)`
                : "-",
            overall_attendance: `${s.attendanceSummary.overallAttendancePercent}%`,
            last_attended: s.attendanceSummary.lastAttendedDate || "-",
            ...feeCols,
          }));
    });

  const exportToExcel = () => {
    const data = exportRows().map((row) => {
      const record = {};
      EXPORT_COLUMNS.forEach((col) => {
        record[col.label] = row[col.key] ?? "";
      });
      return record;
    });
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Student Tracking");
    XLSX.writeFile(workbook, "student_tracking.xlsx");
  };

  const exportToPDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    const head = [EXPORT_COLUMNS.map((col) => col.label)];
    const body = exportRows().map((row) =>
      EXPORT_COLUMNS.map((col) => (row[col.key] ?? "-").toString())
    );
    doc.setFontSize(14);
    doc.text("Student Tracking Report", 10, 12);
    autoTable(doc, {
      head,
      body,
      startY: 18,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [13, 110, 253] },
    });
    doc.save("student_tracking.pdf");
  };

  return (
    <div className="card shadow-sm mt-4">
      <div className="card-body">
        {crossPageNotice && (
          <div className="alert alert-warning alert-dismissible py-2" role="alert">
            {crossPageNotice}
            <button
              type="button"
              className="btn-close"
              onClick={() => setCrossPageNotice("")}
            ></button>
          </div>
        )}
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <h3 className="mb-0">
            <i className="bi bi-person-lines-fill me-2 text-primary"></i>Student Tracking
          </h3>
          <div className="d-flex gap-2 flex-wrap">
            <span className="badge bg-primary fs-6 align-self-center">
              {filteredStudents.length} students
            </span>
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
          </div>
        </div>

        <div className="btn-group btn-group-sm mb-3" role="group">
          <button
            type="button"
            className={`btn ${activeTab === "tracking" ? "btn-primary" : "btn-outline-primary"}`}
            onClick={() => setActiveTab("tracking")}
          >
            Student 360°
          </button>
          <button
            type="button"
            className={`btn ${activeTab === "risk" ? "btn-primary" : "btn-outline-primary"}`}
            onClick={() => setActiveTab("risk")}
          >
            Student Risk Management
          </button>
          <button
            type="button"
            className={`btn ${activeTab === "studentapp" ? "btn-primary" : "btn-outline-primary"}`}
            onClick={() => setActiveTab("studentapp")}
          >
            Student App Attendance
          </button>
        </div>

        {activeTab === "risk" ? (
          <StudentRiskManagement
            students={students}
            loading={loading}
            error={error}
            onOpenStudent={handleOpenFromRisk}
          />
        ) : activeTab === "studentapp" ? (
          <StudentAppAttendance />
        ) : loading ? (
          <p className="text-center text-muted p-4">Loading...</p>
        ) : error ? (
          <p className="text-center text-danger p-4">{error}</p>
        ) : (
          <>
        <div className="row g-2 mb-3 align-items-end">
          <div className="col-md-2">
            <label className="form-label small mb-1">Search</label>
            <div className="input-group">
              <span className="input-group-text bg-white">
                <i className="bi bi-search"></i>
              </span>
              <input
                type="text"
                className="form-control"
                placeholder="Name or enrollment no..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small mb-1">Subject</label>
            <select
              className="form-select"
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
            >
              <option value="">All Subjects</option>
              {subjectOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small mb-1">Teacher</label>
            <select
              className="form-select"
              value={teacherFilter}
              onChange={(e) => setTeacherFilter(e.target.value)}
            >
              <option value="">All Teachers</option>
              {teacherOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small mb-1">Batch</label>
            <select
              className="form-select"
              value={batchFilter}
              onChange={(e) => setBatchFilter(e.target.value)}
            >
              <option value="">All Batches</option>
              {batchOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small mb-1">Attendance</label>
            <select
              className="form-select"
              value={attendanceStatusFilter}
              onChange={(e) => setAttendanceStatusFilter(e.target.value)}
            >
              <option value="">All Attendance</option>
              <option value="Good">Good (≥75%)</option>
              <option value="Warning">Warning (50–74%)</option>
              <option value="Low">Low (&lt;50%)</option>
            </select>
          </div>
          <div className="col-6 col-md-1">
            <label className="form-label small mb-1">Fee</label>
            <select
              className="form-select"
              value={feeStatusFilter}
              onChange={(e) => setFeeStatusFilter(e.target.value)}
            >
              <option value="">All</option>
              <option value="Paid">Paid</option>
              <option value="Partially Paid">Partial</option>
              <option value="Pending">Pending</option>
              <option value="Fee Not Set">Not Set</option>
            </select>
          </div>
          <div className="col-6 col-md-1">
            {hasAnyFilter && (
              <button
                type="button"
                className="btn btn-outline-secondary w-100"
                onClick={clearFilters}
                title="Clear all filters"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
        </div>

        {filteredStudents.length === 0 ? (
          <div className="text-center text-muted py-5">
            <i className="bi bi-inbox fs-3 d-block mb-2"></i>
            No students found.
          </div>
        ) : (
          filteredStudents.map((student) => {
            const isStudentOpen = expandedStudentId === student.id;
            const subjectCount = student.subjects.length;
            const completedSubjectCount = student.subjects.filter(
              (sub) => sub.studentCoveredAllSoFar
            ).length;
            const summary = student.attendanceSummary;
            const fee = student.feeSummary;
            const summaryBadgeClass =
              summary.overallAttendancePercent >= 75
                ? "text-bg-success"
                : summary.overallAttendancePercent >= 50
                  ? "text-bg-warning"
                  : "text-bg-danger";
            const feeBadgeClass = FEE_BADGE_CLASS[fee.status] || "text-bg-secondary";

            const firstSub = student.subjects[0];
            const batchTeacherHint =
              subjectCount === 0
                ? null
                : subjectCount === 1
                  ? `${firstSub.batch_name} · ${firstSub.teacher_name || "No teacher"}`
                  : "Multiple batches";

            // Attendance trend — how many classes were attended per
            // calendar month, derived entirely from data already in the
            // response (no extra backend field). Only worth a table once a
            // student's attendance spans more than one month.
            const attendedDates = student.subjects.flatMap((s) =>
              s.completedTopics.map((t) => t.date)
            );
            const monthCounts = attendedDates.reduce((acc, d) => {
              const month = d.slice(0, 7);
              acc[month] = (acc[month] || 0) + 1;
              return acc;
            }, {});
            const monthEntries = Object.entries(monthCounts).sort(([a], [b]) =>
              a.localeCompare(b)
            );

            return (
              <div
                key={student.id}
                id={`tracking-card-${student.id}`}
                className="border rounded-3 p-3 mb-3 shadow-sm"
              >
                <div
                  role="button"
                  className="d-flex justify-content-between align-items-center flex-wrap gap-2"
                  onClick={() => setExpandedStudentId(isStudentOpen ? null : student.id)}
                >
                  <div className="d-flex align-items-center gap-2">
                    <span
                      className="d-inline-flex align-items-center justify-content-center rounded-circle bg-primary-subtle text-primary fw-bold"
                      style={{ width: "40px", height: "40px", fontSize: "1rem" }}
                    >
                      {(student.applicant_name || "?").charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <strong>{student.applicant_name}</strong>
                      {student.comn_enrol_no && (
                        <span className="text-muted small ms-2">({student.comn_enrol_no})</span>
                      )}
                      <div className="text-muted small">
                        <i className="bi bi-journal-bookmark me-1"></i>
                        {subjectCount} subject{subjectCount === 1 ? "" : "s"} —{" "}
                        {completedSubjectCount} fully covered so far
                        {batchTeacherHint && (
                          <>
                            {" "}
                            · <i className="bi bi-person-badge me-1"></i>
                            {batchTeacherHint}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span className={`badge ${summaryBadgeClass}`}>
                      <i className="bi bi-graph-up me-1"></i>
                      {summary.overallAttendancePercent}% attendance
                    </span>
                    <span className={`badge ${feeBadgeClass}`}>
                      <i className="bi bi-cash-coin me-1"></i>
                      Fee: {fee.status}
                    </span>
                    <i
                      className={`bi ${isStudentOpen ? "bi-chevron-up" : "bi-chevron-down"} text-muted`}
                    ></i>
                  </div>
                </div>

                {isStudentOpen && (
                  <div className="mt-3">
                    {student.riskStatus && RISK_BADGE[student.riskStatus] && (
                      <div className={`alert ${RISK_BADGE[student.riskStatus].alertClass} py-2 px-3 mb-3`}>
                        <div className="fw-semibold mb-1">
                          {RISK_BADGE[student.riskStatus].emoji} {RISK_BADGE[student.riskStatus].label} — Why this student is flagged
                        </div>
                        <div className="d-flex flex-wrap gap-1">
                          {(student.riskReasons || []).map((reason, idx) => (
                            <span key={idx} className="badge bg-white text-dark border">
                              {reason}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Student Header */}
                    <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                      <div className="text-muted small">
                        {student.course_name && (
                          <span>
                            <i className="bi bi-mortarboard me-1"></i>
                            {student.course_name}
                          </span>
                        )}
                        {student.admission_date && (
                          <span className="ms-3">
                            <i className="bi bi-calendar-event me-1"></i>
                            Admitted: {student.admission_date}
                          </span>
                        )}
                      </div>
                      <Link
                        to={`/admissions/${student.id}/details`}
                        className="btn btn-sm btn-outline-primary"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <i className="bi bi-person-vcard me-1"></i>
                        View Admission Details
                      </Link>
                    </div>

                    {/* Summary — Academic / Attendance / Fee at a glance */}
                    <div className="row g-2 mb-3">
                      <div className="col-12 col-md-4">
                        <div className="border rounded-3 p-2 text-center h-100 bg-light-subtle">
                          <div className="fs-6 fw-bold">
                            {completedSubjectCount}/{subjectCount} subjects covered
                          </div>
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                            Academic Progress
                          </div>
                        </div>
                      </div>
                      <div className="col-12 col-md-4">
                        <div className="border rounded-3 p-2 text-center h-100 bg-light-subtle">
                          <div className="fs-6 fw-bold">
                            {summary.overallAttendancePercent}%
                          </div>
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                            Attendance
                          </div>
                        </div>
                      </div>
                      <div className="col-12 col-md-4">
                        <div className="border rounded-3 p-2 text-center h-100 bg-light-subtle">
                          <div className="fs-6 fw-bold">{fee.status}</div>
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                            Fee Status
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Academic Details */}
                    <div className="text-uppercase text-muted small fw-bold mb-2">
                      Academic Progress
                    </div>
                    {student.subjects.length === 0 ? (
                      <div className="text-muted small mb-3">
                        {hasActiveSubjectFilters
                          ? "No enrollments match the selected filters."
                          : "Not enrolled in any batch yet."}
                      </div>
                    ) : (
                      student.subjects.map((sub) => {
                        const subjectKey = `${student.id}-${sub.batch_id}`;
                        const isSubjectOpen = expandedSubjectKey === subjectKey;
                        const topicBarClass =
                          sub.completionPercent >= 100
                            ? "bg-success"
                            : sub.completionPercent >= 50
                              ? "bg-info"
                              : "bg-warning";
                        const durationBarClass = sub.durationComplete
                          ? "bg-success"
                          : (sub.durationPercent || 0) >= 50
                            ? "bg-info"
                            : "bg-warning";
                        return (
                          <div key={subjectKey} className="border rounded-3 p-2 mb-2 bg-light-subtle">
                            <div
                              role="button"
                              className="d-flex justify-content-between align-items-center flex-wrap gap-2"
                              onClick={() =>
                                setExpandedSubjectKey(isSubjectOpen ? null : subjectKey)
                              }
                            >
                              <div style={{ minWidth: "220px" }}>
                                <span className="fw-semibold small">
                                  <i className="bi bi-book me-1 text-primary"></i>
                                  {sub.subject_name}
                                </span>
                                <span className="text-muted small ms-2">{sub.batch_name}</span>
                                <div className="text-muted small">
                                  <i className="bi bi-person-badge me-1"></i>
                                  {sub.teacher_name || "No teacher assigned"}
                                </div>
                              </div>
                              <div className="d-flex align-items-center gap-2 flex-wrap">
                                {sub.teacherMarkedComplete ? (
                                  <span className="badge text-bg-success">
                                    <i className="bi bi-check-circle me-1"></i>
                                    Teacher: Subject Completed
                                  </span>
                                ) : (
                                  <span className="badge text-bg-secondary">Teacher: In Progress</span>
                                )}
                                {sub.durationComplete && (
                                  <span className="badge text-bg-info text-dark">
                                    <i className="bi bi-hourglass-split me-1"></i>
                                    Duration Complete
                                  </span>
                                )}
                                {sub.studentCoveredAllSoFar && (
                                  <span className="badge text-bg-light border text-dark">
                                    No topics missed so far
                                  </span>
                                )}
                                <i
                                  className={`bi ${isSubjectOpen ? "bi-chevron-up" : "bi-chevron-down"} text-muted`}
                                ></i>
                              </div>
                            </div>

                            <div className="row g-3 mt-2">
                              <div className="col-md-6">
                                <div className="d-flex justify-content-between small mb-1">
                                  <span className="fw-semibold">
                                    <i className="bi bi-journal-check me-1"></i>Topic Completion
                                  </span>
                                  <span>{sub.completionPercent}%</span>
                                </div>
                                <div className="progress" style={{ height: "8px" }}>
                                  <div
                                    className={`progress-bar ${topicBarClass}`}
                                    style={{ width: `${sub.completionPercent}%` }}
                                  ></div>
                                </div>
                                <div className="text-muted small mt-1">
                                  {sub.completedTopics.length} completed — {" "}
                                  {sub.totalTopics - sub.completedTopics.length} remaining of{" "}
                                  {sub.totalTopics} taught so far
                                </div>
                              </div>
                              <div className="col-md-6">
                                <div className="d-flex justify-content-between small mb-1">
                                  <span className="fw-semibold">
                                    <i className="bi bi-calendar-range me-1"></i>Batch Progress
                                  </span>
                                  <span>
                                    {sub.numDays != null ? `${sub.durationPercent}%` : "No target set"}
                                  </span>
                                </div>
                                <div className="progress" style={{ height: "8px" }}>
                                  <div
                                    className={`progress-bar ${durationBarClass}`}
                                    style={{ width: `${sub.durationPercent || 0}%` }}
                                  ></div>
                                </div>
                                <div className="text-muted small mt-1">
                                  {sub.numDays != null
                                    ? `${sub.daysCompleted} classes completed of ${sub.numDays} planned days`
                                    : "This batch has no planned-duration target."}
                                </div>
                              </div>
                            </div>

                            {isSubjectOpen && (
                              <div className="row g-2 mt-2">
                                <div className="col-md-6">
                                  <div className="text-success small fw-semibold mb-1">
                                    Completed Topics ({sub.completedTopics.length})
                                  </div>
                                  {sub.completedTopics.length === 0 ? (
                                    <div className="text-muted small">None yet</div>
                                  ) : (
                                    <div className="table-responsive">
                                      <table className="table table-sm table-bordered align-middle mb-0 small">
                                        <thead className="table-light">
                                          <tr>
                                            <th style={{ width: "40px" }}>S.No</th>
                                            <th>Covered Topics</th>
                                            <th>In Time</th>
                                            <th>Out Time</th>
                                            <th>Date</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {sub.completedTopics.map((t, idx) => (
                                            <tr key={t.date}>
                                              <td>{idx + 1}</td>
                                              <td>{t.topic_covered}</td>
                                              <td>{t.in_time || "-"}</td>
                                              <td>{t.out_time || "-"}</td>
                                              <td>{t.date}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                                <div className="col-md-6">
                                  <div className="text-danger small fw-semibold mb-1">
                                    Missed Topics ({sub.missedTopics.length})
                                  </div>
                                  {sub.missedTopics.length === 0 ? (
                                    <div className="text-muted small">None</div>
                                  ) : (
                                    <div className="table-responsive">
                                      <table className="table table-sm table-bordered align-middle mb-0 small">
                                        <thead className="table-light">
                                          <tr>
                                            <th style={{ width: "40px" }}>S.No</th>
                                            <th>Missed Topic</th>
                                            <th>In Time</th>
                                            <th>Out Time</th>
                                            <th>Date</th>
                                            <th>Reason</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {sub.missedTopics.map((t, idx) => (
                                            <tr key={t.date}>
                                              <td>{idx + 1}</td>
                                              <td>{t.topic_covered}</td>
                                              <td>{t.in_time || "-"}</td>
                                              <td>{t.out_time || "-"}</td>
                                              <td>{t.date}</td>
                                              <td>{t.reason}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}

                    {/* Attendance Details */}
                    <div className="text-uppercase text-muted small fw-bold mb-2 mt-3">
                      Attendance
                    </div>
                    {summary.totalClasses > 0 && summary.overallAttendancePercent < 50 && (
                      <div className="alert alert-danger py-1 px-2 small mb-2">
                        <i className="bi bi-exclamation-triangle-fill me-1"></i>
                        Low attendance — below 50%. This student may need attention.
                      </div>
                    )}
                    {summary.totalClasses > 0 &&
                      summary.overallAttendancePercent >= 50 &&
                      summary.overallAttendancePercent < 75 && (
                        <div className="alert alert-warning py-1 px-2 small mb-2">
                          <i className="bi bi-exclamation-circle-fill me-1"></i>
                          Attendance is below the recommended 75% threshold.
                        </div>
                      )}
                    <div className="row g-2 mb-2">
                      <div className="col-6 col-md-2">
                        <div className="border rounded-3 p-2 text-center h-100 bg-light-subtle">
                          <div className="fs-5 fw-bold text-primary">
                            {summary.overallAttendancePercent}%
                          </div>
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                            Overall Attendance
                          </div>
                        </div>
                      </div>
                      <div className="col-6 col-md-2">
                        <div className="border rounded-3 p-2 text-center h-100 bg-light-subtle">
                          <div className="fs-5 fw-bold">{summary.totalClasses}</div>
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                            Total Classes
                          </div>
                        </div>
                      </div>
                      <div className="col-6 col-md-2">
                        <div className="border rounded-3 p-2 text-center h-100 bg-light-subtle">
                          <div className="fs-5 fw-bold text-success">{summary.present}</div>
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                            Present
                          </div>
                        </div>
                      </div>
                      <div className="col-6 col-md-2">
                        <div className="border rounded-3 p-2 text-center h-100 bg-light-subtle">
                          <div className="fs-5 fw-bold text-danger">{summary.absent}</div>
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                            Absent
                          </div>
                        </div>
                      </div>
                      <div className="col-6 col-md-4">
                        <div className="border rounded-3 p-2 text-center h-100 bg-light-subtle">
                          <div className="fs-6 fw-bold">
                            {summary.lastAttendedDate || "—"}
                          </div>
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                            Last Attended Date
                          </div>
                        </div>
                      </div>
                    </div>
                    {monthEntries.length > 1 && (
                      <div className="table-responsive mb-3">
                        <table className="table table-sm table-bordered align-middle mb-0 small">
                          <thead className="table-light">
                            <tr>
                              <th>Month</th>
                              <th>Classes Attended</th>
                            </tr>
                          </thead>
                          <tbody>
                            {monthEntries.map(([month, count]) => (
                              <tr key={month}>
                                <td>{formatMonthLabel(month)}</td>
                                <td>{count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Fee Details */}
                    <div className="text-uppercase text-muted small fw-bold mb-2 mt-3">
                      Fee Status
                    </div>
                    <div className="mb-2">
                      <span className={`badge ${feeBadgeClass}`}>
                        <i className="bi bi-cash-coin me-1"></i>
                        {fee.status}
                      </span>
                    </div>
                    <div className="row g-2 mb-2">
                      <div className="col-6 col-md-3">
                        <div className="border rounded-3 p-2 text-center h-100 bg-light-subtle">
                          <div className="fs-6 fw-bold">
                            {fee.totalFee != null ? `Rs. ${fee.totalFee}` : "Not set"}
                          </div>
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                            Total Course Fee
                          </div>
                        </div>
                      </div>
                      <div className="col-6 col-md-3">
                        <div className="border rounded-3 p-2 text-center h-100 bg-light-subtle">
                          <div className="fs-6 fw-bold text-success">Rs. {fee.totalPaid}</div>
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                            Total Paid
                          </div>
                        </div>
                      </div>
                      <div className="col-6 col-md-3">
                        <div className="border rounded-3 p-2 text-center h-100 bg-light-subtle">
                          <div className="fs-6 fw-bold text-danger">
                            {fee.balance != null ? `Rs. ${fee.balance}` : "-"}
                          </div>
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                            Balance
                          </div>
                        </div>
                      </div>
                      <div className="col-6 col-md-3">
                        <div className="border rounded-3 p-2 text-center h-100 bg-light-subtle">
                          <div className="fs-6 fw-bold">
                            {fee.paymentProgressPercent != null
                              ? `${fee.paymentProgressPercent}%`
                              : "-"}
                          </div>
                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                            Payment Progress
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="text-muted small fw-semibold mb-1">
                      Payment History ({fee.paymentHistory.length})
                    </div>
                    {fee.paymentHistory.length === 0 ? (
                      <div className="text-muted small">No payments recorded yet</div>
                    ) : (
                      <div className="table-responsive">
                        <table className="table table-sm table-bordered align-middle mb-0 small">
                          <thead className="table-light">
                            <tr>
                              <th>Date</th>
                              <th>Amount</th>
                              <th>Payment Method</th>
                              <th>Reference</th>
                            </tr>
                          </thead>
                          <tbody>
                            {fee.paymentHistory.map((p, idx) => (
                              <tr key={`${p.date}-${idx}`}>
                                <td>{p.date || "-"}</td>
                                <td>Rs. {p.amount}</td>
                                <td>{p.payment_mode || "-"}</td>
                                <td>{p.bill_no || "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
          </>
        )}
      </div>
    </div>
  );
}

export default StudentTracking;
