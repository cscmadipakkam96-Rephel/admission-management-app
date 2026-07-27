import { useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import API from "../../api/api";

const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

// Concept 2 — same section/day mapping as server/utils/sections.js. Batch
// section fixes which days it runs, so the weekly grid is computed here
// rather than fetched.
const SECTION_DAYS = {
  fast_track: [...DAYS_OF_WEEK],
  normal_mwf: ["Monday", "Wednesday", "Friday"],
  normal_tts: ["Tuesday", "Thursday", "Saturday"],
  weekend: ["Saturday"],
};

const parseTimePart = (str) => {
  const match = str.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return null;
  return {
    hour: parseInt(match[1], 10),
    minute: match[2] ? parseInt(match[2], 10) : 0,
    ampm: match[3] ? match[3].toUpperCase() : null,
  };
};

const parseTimeRange = (timing) => {
  if (!timing) return null;
  const parts = timing.split("-").map((s) => s.trim());
  if (parts.length !== 2) return null;

  const start = parseTimePart(parts[0]);
  const end = parseTimePart(parts[1]);
  if (!start || !end) return null;

  if (!start.ampm && end.ampm) start.ampm = end.ampm;
  if (!end.ampm && start.ampm) end.ampm = start.ampm;

  const to24 = (t) => {
    let h = t.hour;
    if (t.ampm === "PM" && h !== 12) h += 12;
    if (t.ampm === "AM" && h === 12) h = 0;
    return h * 60 + t.minute;
  };

  return { startMinutes: to24(start), endMinutes: to24(end) };
};

const isWithinClassTime = (timing) => {
  const range = parseTimeRange(timing);
  if (!range) return true;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= range.startMinutes && nowMinutes <= range.endMinutes;
};

function TeacherRegister() {
  // Reached via the Teacher Login page + cookie session (/teacher/dashboard,
  // wrapped in TeacherProtectedRoute which already verified the cookie and
  // hands us the resolved teacher via context).
  const { teacher_name, slug } = useOutletContext();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [expandedBatchId, setExpandedBatchId] = useState(null);
  const [batchMarkingId, setBatchMarkingId] = useState(null);
  const [batchProgress, setBatchProgress] = useState([]);
  const [expandedProgressBatchId, setExpandedProgressBatchId] = useState(null);
  const [expandedSessionKey, setExpandedSessionKey] = useState(null);
  const [subjectCompleteSubmittingId, setSubjectCompleteSubmittingId] = useState(null);
  const [showUnavailableForm, setShowUnavailableForm] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState("");
  const [availabilitySubmitting, setAvailabilitySubmitting] = useState(false);
  const [batchStartingId, setBatchStartingId] = useState(null);
  const [batchEndingId, setBatchEndingId] = useState(null);
  const [batchEndingTopicId, setBatchEndingTopicId] = useState(null);
  const [batchTopicInputs, setBatchTopicInputs] = useState({});
  const [batchRestartingId, setBatchRestartingId] = useState(null);
  const [batchTopicPickerId, setBatchTopicPickerId] = useState(null);
  const [batchTopicSuggestions, setBatchTopicSuggestions] = useState({});
  const [batchTopicSuggestionsLoading, setBatchTopicSuggestionsLoading] = useState(false);
  const [expandedSubjectIds, setExpandedSubjectIds] = useState(() => new Set());

  const toggleSubject = (id) => {
    setExpandedSubjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    const loadDashboard = async () => {
      setDashboardLoading(true);
      try {
        const response = await API.get(`/teacher-auth/dashboard/${slug}`);
        setDashboard(response.data.data);
      } catch (err) {
        setError(err.response?.data?.message || "Failed to load dashboard.");
      } finally {
        setDashboardLoading(false);
      }
    };
    loadDashboard();

    API.get(`/teacher-auth/batch-progress/${slug}`)
      .then((res) => setBatchProgress(res.data.data))
      .catch(() => setBatchProgress([]));
  }, [slug]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleTeacherLogout = async () => {
    try {
      await API.post("/teacher-auth/logout");
    } catch {
      // Cookie clearing on the server is best-effort; still proceed either
      // way since staying on the dashboard would be worse.
    }
    navigate("/teacher-login", { replace: true });
  };

  const handleMarkSubjectComplete = async (batchId) => {
    setSubjectCompleteSubmittingId(batchId);
    try {
      await API.post("/teacher-auth/mark-subject-complete", { batch_id: batchId });
      setBatchProgress((prev) =>
        prev.map((bp) =>
          bp.id === batchId
            ? { ...bp, subjectCompleted: true, subjectCompletedAt: new Date().toISOString() }
            : bp
        )
      );
      setToast({ variant: "success", message: "Subject marked as completed." });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to mark subject as completed.",
      });
    } finally {
      setSubjectCompleteSubmittingId(null);
    }
  };

  const handleUnmarkSubjectComplete = async (batchId) => {
    setSubjectCompleteSubmittingId(batchId);
    try {
      await API.post("/teacher-auth/unmark-subject-complete", { batch_id: batchId });
      setBatchProgress((prev) =>
        prev.map((bp) =>
          bp.id === batchId ? { ...bp, subjectCompleted: false, subjectCompletedAt: null } : bp
        )
      );
      setToast({ variant: "success", message: "Subject completion undone." });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to undo.",
      });
    } finally {
      setSubjectCompleteSubmittingId(null);
    }
  };

  const markBatchPresent = async (admissionId, batchId) => {
    setBatchMarkingId(admissionId);
    try {
      await API.post("/teacher-auth/mark-batch-attendance", {
        slug,
        admission_id: admissionId,
        batch_id: batchId,
      });
      setDashboard((prev) => ({
        ...prev,
        todayBatches: prev.todayBatches.map((b) =>
          b.id === batchId
            ? {
                ...b,
                students: b.students.map((s) =>
                  s.id === admissionId ? { ...s, already_present: true } : s
                ),
              }
            : b
        ),
      }));
      setToast({ variant: "success", message: "Marked present" });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to mark attendance.",
      });
    } finally {
      setBatchMarkingId(null);
    }
  };

  const markUnavailableToday = async () => {
    if (!unavailableReason.trim()) {
      setToast({ variant: "danger", message: "Please enter a reason." });
      return;
    }
    setAvailabilitySubmitting(true);
    try {
      await API.post("/teacher-auth/mark-unavailable", {
        slug,
        reason: unavailableReason.trim(),
      });
      setShowUnavailableForm(false);
      setUnavailableReason("");
      const response = await API.get(`/teacher-auth/dashboard/${slug}`);
      setDashboard(response.data.data);
      setToast({ variant: "success", message: "Marked as not available for today" });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to update.",
      });
    } finally {
      setAvailabilitySubmitting(false);
    }
  };

  const markAvailableToday = async () => {
    setAvailabilitySubmitting(true);
    try {
      await API.post("/teacher-auth/mark-available", { slug });
      const response = await API.get(`/teacher-auth/dashboard/${slug}`);
      setDashboard(response.data.data);
      setToast({ variant: "success", message: "Marked as available again" });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to update.",
      });
    } finally {
      setAvailabilitySubmitting(false);
    }
  };

  const startBatch = async (batchId, topic) => {
    setBatchStartingId(batchId);
    try {
      const response = await API.post("/teacher-auth/start-batch", {
        slug,
        batch_id: batchId,
        topic_covered: topic || undefined,
      });
      setDashboard((prev) => ({
        ...prev,
        todayBatches: prev.todayBatches.map((b) =>
          b.id === batchId
            ? {
                ...b,
                started_at: response.data.data.started_at,
                topic_covered: response.data.data.topic_covered,
              }
            : b
        ),
      }));
      setBatchTopicPickerId(null);
      setToast({ variant: "success", message: "Class started" });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to start class.",
      });
    } finally {
      setBatchStartingId(null);
    }
  };

  // const openBatchTopicPicker = async (batch) => {
  //   if (!isWithinClassTime(batch.timing)) {
  //     window.alert(
  //       `You can only start this class during its scheduled time (${batch.timing || "not set"}). It is not that time right now.`
  //     );
  //     return;
  //   }
  //   setBatchTopicPickerId(batch.id);
  //   if (!batchTopicSuggestions[batch.id]) {
  //     setBatchTopicSuggestionsLoading(true);
  //     try {
  //       const response = await API.get(`/teacher-auth/batch-topics/${batch.id}`);
  //       setBatchTopicSuggestions((prev) => ({ ...prev, [batch.id]: response.data.data }));
  //     } catch {
  //       setBatchTopicSuggestions((prev) => ({ ...prev, [batch.id]: [] }));
  //     } finally {
  //       setBatchTopicSuggestionsLoading(false);
  //     }
  //   }
  // };



  const openBatchTopicPicker = async (batch) => {
    setBatchTopicPickerId(batch.id);
    if (!batchTopicSuggestions[batch.id]) {
      setBatchTopicSuggestionsLoading(true);
      try {
        const response = await API.get(`/teacher-auth/batch-topics/${batch.id}`);
        setBatchTopicSuggestions((prev) => ({ ...prev, [batch.id]: response.data.data }));
      } catch {
        setBatchTopicSuggestions((prev) => ({ ...prev, [batch.id]: [] }));
      } finally {
        setBatchTopicSuggestionsLoading(false);
      }
    }
  };

  const endBatch = async (batchId, alreadyLockedTopic) => {
    const topic = alreadyLockedTopic || (batchTopicInputs[batchId] || "").trim();
    if (!topic) {
      setToast({
        variant: "danger",
        message: "Please enter the topic covered today before ending the class.",
      });
      return;
    }
    setBatchEndingId(batchId);
    try {
      const response = await API.post("/teacher-auth/end-batch", {
        slug,
        batch_id: batchId,
        topic_covered: topic,
      });
      setDashboard((prev) => ({
        ...prev,
        todayBatches: prev.todayBatches.map((b) =>
          b.id === batchId
            ? {
                ...b,
                ended_at: response.data.data.ended_at,
                topic_covered: response.data.data.topic_covered,
              }
            : b
        ),
      }));
      setBatchEndingTopicId(null);
      setBatchTopicInputs((prev) => {
        const next = { ...prev };
        delete next[batchId];
        return next;
      });
      setExpandedBatchId((prev) => (prev === batchId ? null : prev));
      setToast({ variant: "success", message: "Class ended" });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to end class.",
      });
    } finally {
      setBatchEndingId(null);
    }
  };

  const restartBatch = async (batchId) => {
    if (
      !window.confirm(
        "Restart this class? Any attendance already marked today for this batch will be cleared, and you'll start fresh."
      )
    ) {
      return;
    }
    setBatchRestartingId(batchId);
    try {
      await API.post("/teacher-auth/restart-batch", { slug, batch_id: batchId });
      setDashboard((prev) => ({
        ...prev,
        todayBatches: prev.todayBatches.map((b) =>
          b.id === batchId
            ? {
                ...b,
                started_at: null,
                ended_at: null,
                topic_covered: null,
                students: b.students.map((s) => ({ ...s, already_present: false })),
              }
            : b
        ),
      }));
      setExpandedBatchId((prev) => (prev === batchId ? null : prev));
      setToast({ variant: "success", message: "Class restarted." });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to restart class.",
      });
    } finally {
      setBatchRestartingId(null);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f4f6f9" }}>
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

      <div className="bg-primary text-white py-4 px-3 mb-4 shadow-sm">
        <div
          className="container-fluid d-flex justify-content-between align-items-start"
          style={{ maxWidth: "900px" }}
        >
          <div>
            <h3 className="mb-1">{teacher_name}</h3>
            {dashboard?.teacher?.qualification && (
              <div className="small opacity-75">
                {dashboard.teacher.qualification}
              </div>
            )}
            {dashboard?.teacher?.courses?.length > 0 && (
              <div className="small opacity-75">
                Courses: {dashboard.teacher.courses.join(", ")}
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline-light"
            onClick={handleTeacherLogout}
          >
            Logout
          </button>
        </div>
      </div>

      <div className="container-fluid" style={{ maxWidth: "900px" }}>
        {dashboardLoading ? (
          <div className="text-center p-5">
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
          </div>
        ) : error ? (
          <p className="text-danger">{error}</p>
        ) : (
          dashboard && (
            <>
              <div className="card shadow-sm mb-4">
                <div className="card-body text-center">
                  <h5 className="mb-3">My QR Code</h5>
                  <div className="d-flex justify-content-center mb-2">
                    <QRCodeSVG value={slug} size={180} />
                  </div>
                  <div className="text-muted small">
                    Show this QR code to the admin for attendance.
                  </div>
                </div>
              </div>

              {dashboard.holiday && (
                <div className="alert alert-warning mb-4">
                  <i className="bi bi-calendar-x me-2"></i>
                  <strong>Today is a Holiday</strong>
                  {dashboard.holiday.description &&
                    ` — ${dashboard.holiday.description}`}
                  . No classes today.
                </div>
              )}

              {dashboard.upcomingHolidays?.length > 0 && (
                <div className="alert alert-info mb-4">
                  <i className="bi bi-calendar-event me-2"></i>
                  <strong>Upcoming Holiday{dashboard.upcomingHolidays.length > 1 ? "s" : ""}:</strong>{" "}
                  {dashboard.upcomingHolidays
                    .map(
                      (h) =>
                        `${h.date}${h.description ? ` — ${h.description}` : ""}`
                    )
                    .join(", ")}
                </div>
              )}

              {!dashboard.holiday && (
                <div className="card shadow-sm mb-4">
                  <div className="card-body">
                    {dashboard.my_availability ? (
                      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                        <div className="text-danger small">
                          <i className="bi bi-person-x me-1"></i>
                          You marked yourself <strong>not available</strong>{" "}
                          today — {dashboard.my_availability.reason}
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-success"
                          onClick={markAvailableToday}
                          disabled={availabilitySubmitting}
                        >
                          I'm available after all
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                          <div className="small text-muted">
                            Can't come to class today?
                          </div>
                          {!showUnavailableForm && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => setShowUnavailableForm(true)}
                            >
                              Mark Not Available Today
                            </button>
                          )}
                        </div>
                        {showUnavailableForm && (
                          <div className="mt-2 d-flex gap-2 flex-wrap">
                            <input
                              type="text"
                              className="form-control form-control-sm"
                              style={{ maxWidth: "300px" }}
                              placeholder="Reason (required)"
                              value={unavailableReason}
                              onChange={(e) =>
                                setUnavailableReason(e.target.value)
                              }
                            />
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={markUnavailableToday}
                              disabled={availabilitySubmitting}
                            >
                              Submit
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => {
                                setShowUnavailableForm(false);
                                setUnavailableReason("");
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {dashboard.todayBatches?.length > 0 && (
                <div className="card shadow-sm mb-4">
                  <div className="card-body">
                    <h5 className="mb-3">My Batches Today</h5>
                    {dashboard.todayBatches.map((b) => {
                      const isBatchExpanded = expandedBatchId === b.id;
                      return (
                      <div key={b.id} className="border rounded p-3 mb-2">
                        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                          <div>
                            <strong>{b.batch_name}</strong>
                            <span className="text-muted small ms-2">
                              {b.subject_name}
                            </span>
                            <span className="badge bg-info text-dark ms-2">
                              {b.section_label}
                            </span>
                            {b.is_substitute && (
                              <span className="badge bg-warning text-dark ms-2">
                                Substitute Class
                              </span>
                            )}
                            <div className="text-muted small">
                              <i className="bi bi-clock me-1"></i>
                              {b.timing || "No timing set"}
                              {b.num_days && ` — ${b.num_days} days`}
                            </div>
                            {!b.covered_by && (
                              <div className="d-flex align-items-center gap-2 flex-wrap mt-1">
                                {b.started_at && (
                                  <span className="badge bg-success">
                                    <i className="bi bi-play-circle me-1"></i>
                                    Started at{" "}
                                    {new Date(b.started_at).toLocaleTimeString("en-IN")}
                                  </span>
                                )}
                                {b.ended_at && (
                                  <span className="badge bg-secondary">
                                    <i className="bi bi-stop-circle me-1"></i>
                                    Ended at{" "}
                                    {new Date(b.ended_at).toLocaleTimeString("en-IN")}
                                  </span>
                                )}
                                {!b.started_at && (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline-success"
                                    disabled={batchStartingId === b.id}
                                    onClick={() => openBatchTopicPicker(b)}
                                  >
                                    {batchStartingId === b.id ? "Starting..." : "Start Class"}
                                  </button>
                                )}
                                {b.started_at &&
                                  !b.ended_at &&
                                  batchEndingTopicId !== b.id &&
                                  (() => {
                                    const canEnd =
                                      b.students.length === 0 ||
                                      b.students.some((s) => s.already_present);
                                    const handleEndClick = () => {
                                      if (b.topic_covered) {
                                        endBatch(b.id, b.topic_covered);
                                      } else {
                                        setBatchEndingTopicId(b.id);
                                      }
                                    };
                                    return (
                                      <>
                                        <button
                                          type="button"
                                          className="btn btn-sm btn-outline-danger"
                                          disabled={!canEnd || batchEndingId === b.id}
                                          title={
                                            canEnd
                                              ? ""
                                              : "Mark at least one student present before ending the class."
                                          }
                                          onClick={handleEndClick}
                                        >
                                          {batchEndingId === b.id ? "Ending..." : "End Class"}
                                        </button>
                                        <button
                                          type="button"
                                          className="btn btn-sm btn-outline-secondary"
                                          disabled={batchRestartingId === b.id}
                                          title="Undo this class — clears any attendance marked today and lets you start over."
                                          onClick={() => restartBatch(b.id)}
                                        >
                                          {batchRestartingId === b.id
                                            ? "Restarting..."
                                            : "Restart Class"}
                                        </button>
                                      </>
                                    );
                                  })()}
                              </div>
                            )}
                            {!b.started_at && batchTopicPickerId === b.id && (
                              <div className="border rounded p-2 mt-2">
                                <div className="small fw-semibold mb-2">
                                  What topic are you teaching today?
                                </div>
                                {batchTopicSuggestionsLoading ? (
                                  <div className="text-muted small">Loading past topics...</div>
                                ) : (
                                  <>
                                    {(batchTopicSuggestions[b.id] || []).length > 0 && (
                                      <div className="d-flex flex-wrap gap-2 mb-2">
                                        {batchTopicSuggestions[b.id].map((topic) => (
                                          <button
                                            key={topic}
                                            type="button"
                                            className="btn btn-sm btn-outline-primary"
                                            disabled={batchStartingId === b.id}
                                            onClick={() => startBatch(b.id, topic)}
                                          >
                                            {topic}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                    <div className="d-flex gap-2">
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-success"
                                        disabled={batchStartingId === b.id}
                                        onClick={() => startBatch(b.id)}
                                      >
                                        {batchStartingId === b.id
                                          ? "Starting..."
                                          : "New Topic (name it when class ends)"}
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-secondary"
                                        onClick={() => setBatchTopicPickerId(null)}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                            {b.started_at &&
                              !b.ended_at &&
                              batchEndingTopicId === b.id && (
                                <div className="mt-2 d-flex gap-2 flex-wrap align-items-start">
                                  <input
                                    type="text"
                                    className="form-control form-control-sm"
                                    style={{ maxWidth: "280px" }}
                                    placeholder="Topic covered today (required)"
                                    value={batchTopicInputs[b.id] || ""}
                                    onChange={(e) =>
                                      setBatchTopicInputs((prev) => ({
                                        ...prev,
                                        [b.id]: e.target.value,
                                      }))
                                    }
                                  />
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-danger"
                                    disabled={batchEndingId === b.id}
                                    onClick={() => endBatch(b.id)}
                                  >
                                    {batchEndingId === b.id ? "Ending..." : "Confirm End Class"}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-secondary"
                                    onClick={() => {
                                      setBatchEndingTopicId(null);
                                      setBatchTopicInputs((prev) => {
                                        const next = { ...prev };
                                        delete next[b.id];
                                        return next;
                                      });
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}
                            {b.topic_covered && (
                              <div className="text-muted small mt-1">
                                <i className="bi bi-journal-text me-1"></i>
                                Topic covered: {b.topic_covered}
                              </div>
                            )}
                            {(b.alreadyCompletedStudents || []).length > 0 && (
                              <div className="text-muted small mt-1">
                                <i className="bi bi-check2-circle me-1"></i>
                                {b.alreadyCompletedStudents.length} student
                                {b.alreadyCompletedStudents.length === 1 ? "" : "s"} already
                                completed this topic — hidden from the list below.
                              </div>
                            )}
                          </div>
                          {b.covered_by ? (
                            <span className="badge bg-secondary">
                              Covered by {b.covered_by} today
                            </span>
                          ) : (
                            b.started_at && !b.ended_at && (
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-primary"
                                onClick={() => setExpandedBatchId(isBatchExpanded ? null : b.id)}
                              >
                                {isBatchExpanded ? "Hide Students" : "Mark Attendance"}
                              </button>
                            )
                          )}
                        </div>
                        {b.started_at && !b.ended_at && isBatchExpanded && (
                          <div className="mt-3">
                            {(b.students || []).length === 0 ? (
                              <div className="text-muted small">
                                {(b.alreadyCompletedStudents || []).length > 0
                                  ? "All students already completed this topic."
                                  : "No students in this batch yet."}
                              </div>
                            ) : (
                              <div className="row g-2">
                                {b.students.map((s) => (
                                  <div className="col-md-6" key={s.id}>
                                    <div className="d-flex justify-content-between align-items-center border rounded p-2">
                                      <div>
                                        <div className="fw-semibold small">
                                          {s.applicant_name}
                                        </div>
                                        {s.comn_enrol_no && (
                                          <div className="text-muted small">
                                            {s.comn_enrol_no}
                                          </div>
                                        )}
                                      </div>
                                      {s.already_present ? (
                                        <span className="badge bg-success">
                                          <i className="bi bi-check-lg me-1"></i>
                                          Present
                                        </span>
                                      ) : (
                                        <button
                                          type="button"
                                          className="btn btn-sm btn-success"
                                          disabled={batchMarkingId === s.id}
                                          onClick={() => markBatchPresent(s.id, b.id)}
                                        >
                                          {batchMarkingId === s.id ? "..." : "Mark Present"}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="card shadow-sm mb-4">
                <div className="card-body">
                  <h5 className="mb-3">
                    My Weekly Batch Schedule
                  </h5>
                  {(dashboard.myBatches || []).length === 0 ? (
                    <div className="text-muted small">
                      No batches assigned yet.
                    </div>
                  ) : (
                    <div className="row g-2">
                      {DAYS_OF_WEEK.map((day) => {
                        const dayBatches = (dashboard.myBatches || []).filter(
                          (b) => (SECTION_DAYS[b.section] || []).includes(day)
                        );
                        const isToday = day === dashboard.today;
                        return (
                          <div className="col-6 col-md-3" key={day}>
                            <div
                              className={`border rounded p-2 h-100 ${isToday ? "border-primary border-2 bg-light" : ""}`}
                            >
                              <div className="d-flex justify-content-between align-items-start">
                                <strong className="small">{day}</strong>
                                {isToday && (
                                  <span className="badge bg-primary">Today</span>
                                )}
                              </div>
                              {dayBatches.length === 0 ? (
                                <div className="text-muted small mt-1">
                                  No class
                                </div>
                              ) : (
                                dayBatches.map((b) => (
                                  <div key={b.id} className="small mt-1">
                                    <div className="fw-semibold">
                                      {b.batch_name}
                                    </div>
                                    <div className="text-muted">
                                      {b.timing || "No timing"}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="card shadow-sm mb-4">
                <div className="card-body">
                  <h5 className="mb-3">My Batches — Progress &amp; Covered Topics</h5>
                  {batchProgress.length === 0 ? (
                    <div className="text-muted small">No batches assigned yet.</div>
                  ) : (
                    batchProgress.map((bp) => {
                      const isOpen = expandedProgressBatchId === bp.id;
                      return (
                        <div key={bp.id} className="border rounded p-3 mb-2">
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
                              {bp.subjectCompleted && (
                                <span className="badge bg-success ms-2">
                                  <i className="bi bi-check-circle me-1"></i>
                                  Subject Completed
                                </span>
                              )}
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
                              <div className="d-flex justify-content-between align-items-center mb-3">
                                <div className="small text-muted">
                                  {bp.subjectCompleted
                                    ? "You've marked every topic for this subject as covered."
                                    : "Covered every topic for this subject in this batch? Mark it done so admin can see it."}
                                </div>
                                {bp.subjectCompleted ? (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline-secondary flex-shrink-0"
                                    disabled={subjectCompleteSubmittingId === bp.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleUnmarkSubjectComplete(bp.id);
                                    }}
                                  >
                                    {subjectCompleteSubmittingId === bp.id ? "Undoing..." : "Undo"}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-success flex-shrink-0"
                                    disabled={subjectCompleteSubmittingId === bp.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleMarkSubjectComplete(bp.id);
                                    }}
                                  >
                                    {subjectCompleteSubmittingId === bp.id
                                      ? "Marking..."
                                      : "Mark Subject as Completed"}
                                  </button>
                                )}
                              </div>
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
                                  const isSessionOpen = expandedSessionKey === sessionKey;
                                  return (
                                    <div
                                      key={sessionKey}
                                      className="border rounded p-2 mb-2"
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
                                          <span className="fw-semibold small">{s.date}</span>
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
                    })
                  )}
                </div>
              </div>

              <div className="card shadow-sm mb-4">
                <div className="card-body">
                  <h5 className="mb-3">My Courses — Syllabus</h5>
                  {(dashboard.courseSyllabus || []).length === 0 ? (
                    <div className="text-muted small">
                      No courses assigned yet.
                    </div>
                  ) : (
                    dashboard.courseSyllabus.map((course) => (
                      <div key={course.course_id} className="mb-3">
                        <div className="fw-bold mb-2">
                          <span className="badge bg-primary me-2">
                            {course.course_name}
                          </span>
                        </div>
                        {course.subjects.length === 0 ? (
                          <div className="text-muted small mb-2">
                            No subjects mapped to this course yet.
                          </div>
                        ) : (
                          course.subjects.map((subject) => (
                            <div
                              key={subject.id}
                              className="border rounded p-2 mb-2"
                            >
                              <div
                                role="button"
                                className="d-flex justify-content-between align-items-center"
                                onClick={() => toggleSubject(subject.id)}
                              >
                                <div>
                                  <span className="fw-semibold">
                                    {subject.subject_name}
                                  </span>
                                  {subject.parent_name && (
                                    <span className="text-muted small ms-2">
                                      (under {subject.parent_name})
                                    </span>
                                  )}
                                </div>
                                <i
                                  className={`bi ${expandedSubjectIds.has(subject.id) ? "bi-chevron-up" : "bi-chevron-down"} text-muted`}
                                ></i>
                              </div>
                              {expandedSubjectIds.has(subject.id) && (
                                <div className="mt-2">
                                  <div
                                    className="text-muted small mb-2"
                                    style={{ whiteSpace: "pre-line" }}
                                  >
                                    {subject.syllabus ||
                                      subject.description ||
                                      "No syllabus added for this subject yet."}
                                  </div>
                                  {subject.subSubjects.length > 0 && (
                                    <div className="ps-3 border-start">
                                      {subject.subSubjects.map((sub) => (
                                        <div key={sub.id} className="mb-2">
                                          <div
                                            role="button"
                                            className="d-flex justify-content-between align-items-center"
                                            onClick={() =>
                                              toggleSubject(sub.id)
                                            }
                                          >
                                            <span className="fw-semibold small">
                                              {sub.subject_name}
                                            </span>
                                            <i
                                              className={`bi ${expandedSubjectIds.has(sub.id) ? "bi-chevron-up" : "bi-chevron-down"} text-muted`}
                                            ></i>
                                          </div>
                                          {expandedSubjectIds.has(sub.id) && (
                                            <div
                                              className="text-muted small mt-1"
                                              style={{
                                                whiteSpace: "pre-line",
                                              }}
                                            >
                                              {sub.syllabus ||
                                                sub.description ||
                                                "No syllabus added for this sub-subject yet."}
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}

export default TeacherRegister;
