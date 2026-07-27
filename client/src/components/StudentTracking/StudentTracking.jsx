import { useEffect, useMemo, useState } from "react";
import API from "../../api/api";

function StudentTracking() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
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

  const filteredStudents = useMemo(() => {
    if (!searchTerm.trim()) return students;
    const term = searchTerm.trim().toLowerCase();
    return students.filter(
      (s) =>
        (s.applicant_name || "").toLowerCase().includes(term) ||
        (s.comn_enrol_no || "").toLowerCase().includes(term)
    );
  }, [students, searchTerm]);

  if (loading) return <p className="text-center text-muted p-4">Loading...</p>;
  if (error) return <p className="text-center text-danger p-4">{error}</p>;

  return (
    <div className="card shadow-sm mt-4">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <h3 className="mb-0">
            <i className="bi bi-person-lines-fill me-2 text-primary"></i>Student Tracking
          </h3>
          <span className="badge bg-primary fs-6">{filteredStudents.length} students</span>
        </div>

        <div className="input-group mb-3" style={{ maxWidth: "350px" }}>
          <span className="input-group-text bg-white">
            <i className="bi bi-search"></i>
          </span>
          <input
            type="text"
            className="form-control"
            placeholder="Search by student name or enrollment no..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
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

            return (
              <div key={student.id} className="border rounded p-3 mb-2">
                <div
                  role="button"
                  className="d-flex justify-content-between align-items-center flex-wrap gap-2"
                  onClick={() => setExpandedStudentId(isStudentOpen ? null : student.id)}
                >
                  <div>
                    <strong>{student.applicant_name}</strong>
                    {student.comn_enrol_no && (
                      <span className="text-muted small ms-2">({student.comn_enrol_no})</span>
                    )}
                    <div className="text-muted small">
                      {subjectCount} subject{subjectCount === 1 ? "" : "s"} —{" "}
                      {completedSubjectCount} fully covered so far
                    </div>
                  </div>
                  <i className={`bi ${isStudentOpen ? "bi-chevron-up" : "bi-chevron-down"} text-muted`}></i>
                </div>

                {isStudentOpen && (
                  <div className="mt-3">
                    {student.subjects.length === 0 ? (
                      <div className="text-muted small">Not enrolled in any batch yet.</div>
                    ) : (
                      student.subjects.map((sub) => {
                        const subjectKey = `${student.id}-${sub.batch_id}`;
                        const isSubjectOpen = expandedSubjectKey === subjectKey;
                        const barClass =
                          sub.completionPercent >= 100
                            ? "bg-success"
                            : sub.completionPercent >= 50
                              ? "bg-info"
                              : "bg-warning";
                        return (
                          <div key={subjectKey} className="border rounded p-2 mb-2 bg-light-subtle">
                            <div
                              role="button"
                              className="d-flex justify-content-between align-items-center flex-wrap gap-2"
                              onClick={() =>
                                setExpandedSubjectKey(isSubjectOpen ? null : subjectKey)
                              }
                            >
                              <div style={{ minWidth: "220px" }}>
                                <span className="fw-semibold small">{sub.subject_name}</span>
                                <span className="text-muted small ms-2">{sub.batch_name}</span>
                                <div className="text-muted small">
                                  <i className="bi bi-person-badge me-1"></i>
                                  {sub.teacher_name || "No teacher assigned"}
                                </div>
                              </div>
                              <div className="d-flex align-items-center gap-2 flex-wrap">
                                {sub.teacherMarkedComplete ? (
                                  <span className="badge bg-success">
                                    <i className="bi bi-check-circle me-1"></i>
                                    Teacher: Subject Completed
                                  </span>
                                ) : (
                                  <span className="badge bg-secondary">Teacher: In Progress</span>
                                )}
                                {sub.studentCoveredAllSoFar && (
                                  <span className="badge bg-info text-dark">
                                    Student attended all topics so far
                                  </span>
                                )}
                                <i
                                  className={`bi ${isSubjectOpen ? "bi-chevron-up" : "bi-chevron-down"} text-muted`}
                                ></i>
                              </div>
                            </div>

                            <div className="mt-2" style={{ maxWidth: "400px" }}>
                              <div className="d-flex justify-content-between small mb-1">
                                <span>
                                  {sub.completedTopics.length} of {sub.totalTopics} topics
                                  completed
                                </span>
                                <span>{sub.completionPercent}%</span>
                              </div>
                              <div className="progress" style={{ height: "8px" }}>
                                <div
                                  className={`progress-bar ${barClass}`}
                                  style={{ width: `${sub.completionPercent}%` }}
                                ></div>
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
                                    sub.completedTopics.map((t) => (
                                      <div key={t.date} className="small">
                                        <span className="text-muted">{t.date}</span> —{" "}
                                        {t.topic_covered}
                                        {(t.in_time || t.out_time) && (
                                          <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                            <i className="bi bi-clock me-1"></i>
                                            In: {t.in_time || "-"} — Out: {t.out_time || "-"}
                                          </div>
                                        )}
                                      </div>
                                    ))
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
