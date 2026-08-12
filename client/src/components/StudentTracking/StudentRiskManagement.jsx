import { useMemo, useState } from "react";
import { Modal } from "bootstrap";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import API from "../../api/api";
import AddFollowUpModal from "../FollowUpManagement/AddFollowUpModal";

// A reasonable Follow-Up Type guess from which risk signal(s) actually
// flagged this student — still just a default, editable in the modal.
const suggestFollowUpType = (reasons) => {
  const text = (reasons || []).join(" ").toLowerCase();
  if (text.includes("fee")) return "Fee";
  if (text.includes("attend")) return "Attendance";
  return "General";
};

// Same three tiers server/utils/studentRisk.js classifies every student
// into — single source of truth for label/emoji/badge class here so the
// summary cards, table badges, and filter dropdown never drift apart.
const RISK_LEVELS = [
  {
    key: "at_risk",
    label: "At Risk",
    emoji: "🔴",
    badgeClass: "text-bg-danger",
    borderClass: "border-danger",
  },
  {
    key: "needs_attention",
    label: "Needs Attention",
    emoji: "🟠",
    badgeClass: "text-bg-warning",
    borderClass: "border-warning",
  },
  {
    key: "on_track",
    label: "On Track",
    emoji: "🟢",
    badgeClass: "text-bg-success",
    borderClass: "border-success",
  },
];
const RISK_LEVEL_BY_KEY = Object.fromEntries(RISK_LEVELS.map((r) => [r.key, r]));

const FEE_BADGE_CLASS = {
  Paid: "text-bg-success",
  "Partially Paid": "text-bg-warning",
  Pending: "text-bg-danger",
  "Fee Not Set": "text-bg-secondary",
};

const RISK_EXPORT_COLUMNS = [
  { key: "applicant_name", label: "Student" },
  { key: "comn_enrol_no", label: "Enrolment No" },
  { key: "course_name", label: "Course" },
  { key: "batch_names", label: "Batch" },
  { key: "teacher_names", label: "Teacher" },
  { key: "attendance", label: "Attendance" },
  { key: "academic_progress", label: "Academic Progress" },
  { key: "fee_status", label: "Fee Status" },
  { key: "fee_balance", label: "Fee Balance" },
  { key: "last_attended", label: "Last Attended" },
  { key: "risk_status", label: "Risk Status" },
  { key: "risk_reason", label: "Risk Reason" },
];

const daysAgoLabel = (dateStr) => {
  if (!dateStr) return "Never";
  const today = new Date();
  const todayMid = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const d = new Date(dateStr);
  const dMid = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((todayMid - dMid) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
};

const progressBarClass = (percent) =>
  percent >= 75 ? "bg-success" : percent >= 50 ? "bg-warning" : "bg-danger";

function StudentRiskManagement({ students, loading, error, onOpenStudent }) {
  const [riskStatusFilter, setRiskStatusFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [teacherFilter, setTeacherFilter] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [followUpPreselect, setFollowUpPreselect] = useState(null);
  const [followUpDefaults, setFollowUpDefaults] = useState({ type: "General", reason: "", note: "" });

  // /batches/student-tracking doesn't carry mobile_no, but the Follow-Up
  // preview card wants it — fetch the full Admission record on demand,
  // only when this specific button is actually clicked (not for every row
  // up front).
  const openFollowUp = async (student) => {
    let record = { id: student.id, applicant_name: student.applicant_name, comn_enrol_no: student.comn_enrol_no };
    try {
      const response = await API.get(`/admissions/${student.id}`);
      record = response.data.data;
    } catch {
      // Fall back to the partial record already in hand — the modal still
      // works, just without a phone number in the preview.
    }
    setFollowUpPreselect({ type: "admission", record });
    setFollowUpDefaults({
      type: suggestFollowUpType(student.riskReasons),
      reason: `${student.riskStatus === "at_risk" ? "At Risk" : "Needs Attention"} — flagged in Risk Management`,
      note: (student.riskReasons || []).join("; "),
    });
    Modal.getOrCreateInstance(document.getElementById("addFollowUpModal")).show();
  };

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

  const riskCounts = useMemo(() => {
    const counts = { at_risk: 0, needs_attention: 0, on_track: 0 };
    students.forEach((s) => {
      if (counts[s.riskStatus] !== undefined) counts[s.riskStatus]++;
    });
    return counts;
  }, [students]);

  const hasActiveFilters =
    riskStatusFilter || subjectFilter || teacherFilter || batchFilter || searchTerm;

  const clearFilters = () => {
    setRiskStatusFilter("");
    setSubjectFilter("");
    setTeacherFilter("");
    setBatchFilter("");
    setSearchTerm("");
  };

  const filteredStudents = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return students.filter((s) => {
      if (riskStatusFilter && s.riskStatus !== riskStatusFilter) return false;
      if (
        term &&
        !(s.applicant_name || "").toLowerCase().includes(term) &&
        !(s.comn_enrol_no || "").toLowerCase().includes(term)
      ) {
        return false;
      }
      if (
        (subjectFilter || teacherFilter || batchFilter) &&
        !s.subjects.some(
          (sub) =>
            (!subjectFilter || sub.subject_name === subjectFilter) &&
            (!teacherFilter || sub.teacher_name === teacherFilter) &&
            (!batchFilter || sub.batch_name === batchFilter)
        )
      ) {
        return false;
      }
      return true;
    });
  }, [students, riskStatusFilter, subjectFilter, teacherFilter, batchFilter, searchTerm]);

  const uniqueBatchNames = (student) =>
    [...new Set(student.subjects.map((s) => s.batch_name))].filter(Boolean).join(", ") || "-";
  const uniqueTeacherNames = (student) =>
    [...new Set(student.subjects.map((s) => s.teacher_name))].filter(Boolean).join(", ") || "-";

  const exportRows = () =>
    filteredStudents.map((s) => ({
      applicant_name: s.applicant_name,
      comn_enrol_no: s.comn_enrol_no,
      course_name: s.course_name || "-",
      batch_names: uniqueBatchNames(s),
      teacher_names: uniqueTeacherNames(s),
      attendance: `${s.attendanceSummary.overallAttendancePercent}%`,
      academic_progress:
        s.academicProgressPercent != null ? `${s.academicProgressPercent}%` : "-",
      fee_status: s.feeSummary.status,
      fee_balance: s.feeSummary.balance != null ? `Rs. ${s.feeSummary.balance}` : "-",
      last_attended: s.attendanceSummary.lastAttendedDate || "Never",
      risk_status: RISK_LEVEL_BY_KEY[s.riskStatus]?.label || s.riskStatus,
      risk_reason: s.riskReasons?.join("; ") || "-",
    }));

  const exportToExcel = () => {
    const data = exportRows().map((row) => {
      const record = {};
      RISK_EXPORT_COLUMNS.forEach((col) => {
        record[col.label] = row[col.key] ?? "";
      });
      return record;
    });
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Student Risk");
    XLSX.writeFile(workbook, "student_risk_management.xlsx");
  };

  const exportToPDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    const head = [RISK_EXPORT_COLUMNS.map((col) => col.label)];
    const body = exportRows().map((row) =>
      RISK_EXPORT_COLUMNS.map((col) => (row[col.key] ?? "-").toString())
    );
    doc.setFontSize(14);
    doc.text("Student Risk Management Report", 10, 12);
    autoTable(doc, {
      head,
      body,
      startY: 18,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [13, 110, 253] },
    });
    doc.save("student_risk_management.pdf");
  };

  if (loading) {
    return <p className="text-center text-muted p-4">Analyzing student progress...</p>;
  }
  if (error) {
    return <p className="text-center text-danger p-4">Unable to load student risk data.</p>;
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <div className="text-muted small">
          Who needs attention today — attendance, engagement, and fee signals
          combined into one quick view.
        </div>
        <div className="d-flex gap-2 flex-wrap">
          <button
            type="button"
            className="btn btn-outline-success btn-sm"
            onClick={exportToExcel}
            disabled={filteredStudents.length === 0}
          >
            <i className="bi bi-file-earmark-excel me-1"></i> Export Excel
          </button>
          <button
            type="button"
            className="btn btn-outline-danger btn-sm"
            onClick={exportToPDF}
            disabled={filteredStudents.length === 0}
          >
            <i className="bi bi-file-earmark-pdf me-1"></i> Export PDF
          </button>
        </div>
      </div>

      {/* Risk Summary */}
      <div className="row g-2 mb-3">
        <div className="col-6 col-md-3">
          <div
            role="button"
            className={`border rounded-3 p-3 text-center h-100 ${!riskStatusFilter ? "border-primary border-2" : ""}`}
            onClick={() => setRiskStatusFilter("")}
          >
            <div className="fs-4 fw-bold">{students.length}</div>
            <div className="text-muted small">Total Students</div>
          </div>
        </div>
        {RISK_LEVELS.map((level) => (
          <div className="col-6 col-md-3" key={level.key}>
            <div
              role="button"
              className={`rounded-3 p-3 text-center h-100 ${level.badgeClass} ${riskStatusFilter === level.key ? "border border-3 border-dark" : ""}`}
              onClick={() =>
                setRiskStatusFilter((prev) => (prev === level.key ? "" : level.key))
              }
            >
              <div className="fs-4 fw-bold">{riskCounts[level.key]}</div>
              <div className="small">
                {level.emoji} {level.label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Smart Filters */}
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
          <label className="form-label small mb-1">Risk Status</label>
          <select
            className="form-select"
            value={riskStatusFilter}
            onChange={(e) => setRiskStatusFilter(e.target.value)}
          >
            <option value="">All</option>
            {RISK_LEVELS.map((level) => (
              <option key={level.key} value={level.key}>
                {level.emoji} {level.label}
              </option>
            ))}
          </select>
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
          {hasActiveFilters && (
            <button
              type="button"
              className="btn btn-outline-secondary w-100"
              onClick={clearFilters}
            >
              <i className="bi bi-x-lg me-1"></i> Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Risk Student List */}
      {filteredStudents.length === 0 ? (
        <div className="text-center text-muted py-5">
          <i className="bi bi-inbox fs-3 d-block mb-2"></i>
          {students.length === 0
            ? "No students found."
            : !hasActiveFilters && riskCounts.at_risk === 0 && riskCounts.needs_attention === 0
              ? "Great! No students currently require attention."
              : "No students match the current filters."}
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-striped table-hover align-middle">
            <thead className="table-primary">
              <tr>
                <th>Student</th>
                <th>Course / Batch / Teacher</th>
                <th style={{ minWidth: "130px" }}>Attendance</th>
                <th style={{ minWidth: "130px" }}>Academic Progress</th>
                <th>Fee</th>
                <th>Last Attended</th>
                <th>Risk</th>
                <th>Reasons</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredStudents.map((s) => {
                const level = RISK_LEVEL_BY_KEY[s.riskStatus];
                const attendancePercent = s.attendanceSummary.overallAttendancePercent;
                return (
                  <tr key={s.id} className={level ? level.borderClass : ""} style={{ borderLeftWidth: "4px", borderLeftStyle: "solid" }}>
                    <td>
                      <div className="fw-semibold">{s.applicant_name}</div>
                      <div className="text-muted small">{s.comn_enrol_no || "-"}</div>
                    </td>
                    <td className="small">
                      <div>{s.course_name || "-"}</div>
                      <div className="text-muted">{uniqueBatchNames(s)}</div>
                      <div className="text-muted">{uniqueTeacherNames(s)}</div>
                    </td>
                    <td>
                      <div className="d-flex justify-content-between small mb-1">
                        <span>{attendancePercent}%</span>
                      </div>
                      <div className="progress" style={{ height: "6px" }}>
                        <div
                          className={`progress-bar ${progressBarClass(attendancePercent)}`}
                          style={{ width: `${attendancePercent}%` }}
                        ></div>
                      </div>
                    </td>
                    <td>
                      {s.academicProgressPercent != null ? (
                        <>
                          <div className="d-flex justify-content-between small mb-1">
                            <span>{s.academicProgressPercent}%</span>
                          </div>
                          <div className="progress" style={{ height: "6px" }}>
                            <div
                              className={`progress-bar ${progressBarClass(s.academicProgressPercent)}`}
                              style={{ width: `${s.academicProgressPercent}%` }}
                            ></div>
                          </div>
                        </>
                      ) : (
                        <span className="text-muted small">No data</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${FEE_BADGE_CLASS[s.feeSummary.status] || "text-bg-secondary"} d-block mb-1`}>
                        {s.feeSummary.status}
                      </span>
                      <span className="small text-muted">
                        {s.feeSummary.balance != null ? `Rs. ${s.feeSummary.balance}` : "-"}
                      </span>
                    </td>
                    <td className="small">{daysAgoLabel(s.attendanceSummary.lastAttendedDate)}</td>
                    <td>
                      {level && (
                        <span className={`badge ${level.badgeClass}`}>
                          {level.emoji} {level.label}
                        </span>
                      )}
                    </td>
                    <td className="small" style={{ maxWidth: "220px" }}>
                      {s.riskReasons && s.riskReasons.length > 0 ? (
                        s.riskReasons.map((reason, idx) => (
                          <span
                            key={idx}
                            className="badge text-bg-light border text-dark d-inline-block mb-1 me-1"
                          >
                            {reason}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted">No issues</span>
                      )}
                    </td>
                    <td className="d-flex gap-2">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary"
                        title="View Student 360°"
                        onClick={() => onOpenStudent(s.id)}
                      >
                        <i className="bi bi-eye"></i>
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-warning"
                        title="Follow Up"
                        onClick={() => openFollowUp(s)}
                      >
                        <i className="bi bi-telephone-outbound"></i>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AddFollowUpModal
        preselected={followUpPreselect}
        defaultType={followUpDefaults.type}
        defaultReason={followUpDefaults.reason}
        defaultNote={followUpDefaults.note}
        onSaved={() => {}}
      />
    </div>
  );
}

export default StudentRiskManagement;
