import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import API from "../../api/api";

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
];

function StudentTracking() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [teacherFilter, setTeacherFilter] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [expandedStudentId, setExpandedStudentId] = useState(null);
  const [expandedSubjectKey, setExpandedSubjectKey] = useState(null);

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

  // Search narrows which students show up; the Subject/Teacher/Batch
  // filters narrow which of that student's enrollments are shown — a
  // student stays visible as long as at least one enrollment matches (or,
  // with no filters active, everyone shows including the not-yet-enrolled).
  const filteredStudents = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return students
      .filter(
        (s) =>
          !term ||
          (s.applicant_name || "").toLowerCase().includes(term) ||
          (s.comn_enrol_no || "").toLowerCase().includes(term)
      )
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
        // visible on screen.
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
  }, [students, searchTerm, subjectFilter, teacherFilter, batchFilter, hasActiveSubjectFilters]);

  const clearFilters = () => {
    setSearchTerm("");
    setSubjectFilter("");
    setTeacherFilter("");
    setBatchFilter("");
  };

  const exportRows = () =>
    filteredStudents.flatMap((s) =>
      s.subjects.length === 0
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
          }))
    );

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

  if (loading) return <p className="text-center text-muted p-4">Loading...</p>;
  if (error) return <p className="text-center text-danger p-4">{error}</p>;

  return (
    <div className="card shadow-sm mt-4">
      <div className="card-body">
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
                placeholder="Name or enrollment no..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="col-6 col-md-3">
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
          <div className="col-6 col-md-3">
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
          <div className="col-6 col-md-1">
            {(searchTerm || hasActiveSubjectFilters) && (
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
            const summaryBadgeClass =
              summary.overallAttendancePercent >= 75
                ? "text-bg-success"
                : summary.overallAttendancePercent >= 50
                  ? "text-bg-warning"
                  : "text-bg-danger";

            return (
              <div key={student.id} className="border rounded-3 p-3 mb-3 shadow-sm">
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
                      </div>
                    </div>
                  </div>
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span className={`badge ${summaryBadgeClass}`}>
                      <i className="bi bi-graph-up me-1"></i>
                      {summary.overallAttendancePercent}% overall attendance
                    </span>
                    <i
                      className={`bi ${isStudentOpen ? "bi-chevron-up" : "bi-chevron-down"} text-muted`}
                    ></i>
                  </div>
                </div>

                {isStudentOpen && (
                  <div className="mt-3">
                    <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                      <div className="text-uppercase text-muted small fw-bold">
                        Overall Attendance Summary
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

                    <div className="row g-2 mb-3">
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

                    {student.subjects.length === 0 ? (
                      <div className="text-muted small">
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
                                    sub.missedTopics.map((t) => (
                                      <div key={t.date} className="small">
                                        <span className="text-muted">{t.date}</span> —{" "}
                                        {t.topic_covered}
                                        {(t.in_time || t.out_time) && (
                                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                            <i className="bi bi-clock me-1"></i>
                                            In: {t.in_time || "-"} — Out: {t.out_time || "-"}
                                          </div>
                                        )}
                                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                          {t.reason}
                                        </div>
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
          })
        )}
      </div>
    </div>
  );
}

export default StudentTracking;
