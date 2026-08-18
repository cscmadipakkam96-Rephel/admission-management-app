import { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { JitsiMeeting } from "@jitsi/react-sdk";
import API from "../../api/api";
import { createCallRecorder } from "../../utils/callRecorder";
import {
  parseTimingRange,
  matchTimingStatus,
  TIMING_STATUS_TABS,
} from "../../utils/timingMatch";

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
  fast_track: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  normal_mwf: ["Monday", "Wednesday", "Friday"],
  normal_tts: ["Tuesday", "Thursday", "Saturday"],
  weekend: ["Saturday"],
};

const OWN_BATCH_SECTIONS = [
  { key: "fast_track", label: "Fast Track (Mon-Sat)" },
  { key: "normal_mwf", label: "Normal Track (Mon/Wed/Fri)" },
  { key: "normal_tts", label: "Normal Track (Tue/Thu/Sat)" },
  { key: "weekend", label: "Weekend (Saturday)" },
];

const blankOwnBatchForm = () => ({
  id: null,
  batch_name: "",
  section: "",
  subject_id: "",
  start_time: "",
  end_time: "",
  num_days: "",
});

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

let sessionFormKeySeq = 0;
const newSessionFormKey = () => `session-${Date.now()}-${sessionFormKeySeq++}`;
const blankSessionFormCard = ({ start_time = "", end_time = "" } = {}) => ({
  key: newSessionFormKey(),
  date: new Date().toISOString().slice(0, 10),
  start_time,
  end_time,
  topic_covered: "",
  attendance: {},
});

// 12-hour "8:00 am" / "12:00 pm" only — no 24-hour ("14:00"), no ranges
// ("1 to 2 pm"), no free text. Teachers type these by hand, so the format
// has to be unambiguous and easy to validate on submit.
// Leading zero is optional — "5:00 pm" and "05:00 pm" (the latter is how
// Batch Management stores/defaults its own timing) must both validate.
const TIME_12H_PATTERN = /^(1[0-2]|0?[1-9]):[0-5]\d (am|pm)$/;

// Strips anything that can't appear in a valid entry as the teacher types,
// and lower-cases "AM"/"PM"/"Am" etc. so the field always reads "am"/"pm".
const sanitizeTime12Input = (raw) => {
  const stripped = raw.replace(/[^0-9:apmAPM ]/g, "");
  return stripped.replace(/am/gi, "am").replace(/pm/gi, "pm");
};

// "8:00 am" -> "08:00" for the API (server parses start/end as 24-hour and
// Postgres TIME columns get in/out as plain HH:MM too).
const to24HourTime = (value12) => {
  const match = (value12 || "").match(/^(\d{1,2}):(\d{2}) (am|pm)$/);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = match[2];
  const period = match[3];
  if (period === "pm" && hour !== 12) hour += 12;
  if (period === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
};

// Converts whatever the server hands back — an ISO timestamp (started_at/
// ended_at) or a plain "HH:MM[:SS]" TIME string (in_time/out_time) — into
// the "8:00 am" display format the text inputs use.
const formatTime12 = (value) => {
  if (!value) return "";
  let hour;
  let minute;
  const plainMatch = String(value).match(/^(\d{1,2}):(\d{2})(:\d{2})?$/);
  if (plainMatch) {
    hour = parseInt(plainMatch[1], 10);
    minute = plainMatch[2];
  } else {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    hour = d.getHours();
    minute = String(d.getMinutes()).padStart(2, "0");
  }
  const period = hour >= 12 ? "pm" : "am";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute} ${period}`;
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
  // Online Class — only relevant when dashboard.teacher.can_host_online_classes
  // is true (admin-granted), same gating pattern as own-batch creation above.
  const [onlineModeByBatch, setOnlineModeByBatch] = useState({});
  const [batchCancellingId, setBatchCancellingId] = useState(null);
  // Which batch's Jitsi call is currently rendered in-page for the teacher
  // (moderator) — set once /online-class/moderator-token resolves.
  const [activeOnlineCallByBatch, setActiveOnlineCallByBatch] = useState({});
  const [joiningCallId, setJoiningCallId] = useState(null);
  // Recorder instances are mutable objects with methods, not serializable
  // data — kept in a ref, keyed by batch id. recordingStatusByBatch (state)
  // drives what the UI actually renders ("recording" | "uploading").
  const recordersRef = useRef({});
  const [recordingStatusByBatch, setRecordingStatusByBatch] = useState({});
  const [copyingLinkFor, setCopyingLinkFor] = useState(null);
  const [batchTopicSuggestions, setBatchTopicSuggestions] = useState({});
  const [batchTopicSuggestionsLoading, setBatchTopicSuggestionsLoading] = useState(false);
  const [expandedSubjectIds, setExpandedSubjectIds] = useState(() => new Set());
  // "Forgot Class" — backfill/edit a session with an explicit date/time
  // instead of the live Start/End Class flow. sessionId null = adding a
  // new missed class; sessionId set = editing that existing entry.
  const [sessionForm, setSessionForm] = useState(null);
  const [sessionFormSubmitting, setSessionFormSubmitting] = useState(false);
  const [sessionFormError, setSessionFormError] = useState("");
  // Multiple missed classes for the same batch, added together in one go —
  // each card is independent (own date/time/topic/attendance) until the
  // final "Add Classes" submits them all.
  const [addSessionBatchId, setAddSessionBatchId] = useState(null);
  const [addSessionForms, setAddSessionForms] = useState([]);
  const [addSessionSubmitting, setAddSessionSubmitting] = useState(false);
  const [addSessionError, setAddSessionError] = useState("");
  // Per-card save-one-at-a-time state, keyed by card.key — independent of
  // the bulk "Add Classes" submit below.
  const [cardSubmittingKeys, setCardSubmittingKeys] = useState({});
  const [cardErrors, setCardErrors] = useState({});
  const [oldTopicOptions, setOldTopicOptions] = useState([]);
  const [deletingSessionId, setDeletingSessionId] = useState(null);

  // Teacher self-service batch creation — only relevant when
  // dashboard.teacher.can_create_batches is true (admin-granted).
  const [ownBatchSubjects, setOwnBatchSubjects] = useState([]);
  const [ownBatchForm, setOwnBatchForm] = useState(null);
  const [ownBatchStudentOptions, setOwnBatchStudentOptions] = useState([]);
  const [ownBatchSelectedStudentIds, setOwnBatchSelectedStudentIds] = useState([]);
  const [ownBatchErrors, setOwnBatchErrors] = useState({});
  const [ownBatchSubmitting, setOwnBatchSubmitting] = useState(false);
  const [deletingOwnBatchId, setDeletingOwnBatchId] = useState(null);
  const [ownStudentTimingTab, setOwnStudentTimingTab] = useState("match");
  const ownBatchTimingRange = ownBatchForm
    ? parseTimingRange(`${ownBatchForm.start_time} - ${ownBatchForm.end_time}`)
    : null;

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

  // A closed tab can't be intercepted to force an upload — this is just a
  // last line of defense so an accidental close doesn't silently discard a
  // recording that was never stopped through any of the app's own buttons.
  useEffect(() => {
    const hasActiveRecording = Object.values(recordingStatusByBatch).some(
      (status) => status === "recording" || status === "uploading"
    );
    if (!hasActiveRecording) return;
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [recordingStatusByBatch]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Once the last card is gone — whether removed by hand or saved
  // individually — there's nothing left to add, so close the panel.
  useEffect(() => {
    if (addSessionBatchId && addSessionForms.length === 0) {
      setAddSessionBatchId(null);
      setCardErrors({});
      setCardSubmittingKeys({});
    }
  }, [addSessionForms, addSessionBatchId]);

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

  const startBatch = async (batchId, topic, mode) => {
    const isOnline = mode === "Online";
    setBatchStartingId(batchId);
    try {
      const response = await API.post("/teacher-auth/start-batch", {
        slug,
        batch_id: batchId,
        topic_covered: topic || undefined,
        class_mode: isOnline ? "Online" : "Offline",
      });
      setDashboard((prev) => ({
        ...prev,
        todayBatches: prev.todayBatches.map((b) =>
          b.id === batchId
            ? {
                ...b,
                started_at: response.data.data.started_at,
                topic_covered: response.data.data.topic_covered,
                class_mode: response.data.data.class_mode,
                cancelled_at: null,
              }
            : b
        ),
      }));
      setBatchTopicPickerId(null);
      setOnlineModeByBatch((prev) => ({ ...prev, [batchId]: "Offline" }));
      setToast({ variant: "success", message: isOnline ? "Online class started" : "Class started" });
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
    // A teacher who forgets to hit "Stop Recording" still gets a saved
    // recording — this doesn't block ending class on the upload finishing.
    // The presign is reserved now, before end-batch closes the session,
    // since the live-session check on the presign endpoint would otherwise
    // reject a request that arrives after the session is already ended.
    if (recordingStatusByBatch[batchId] === "recording") {
      let recordingPresign = null;
      try {
        recordingPresign = await reserveRecordingUpload(batchId);
      } catch {
        // stopRecordingForBatch will surface the upload failure
      }
      stopRecordingForBatch(batchId, recordingPresign, "ended");
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
    // Restart wipes the session, but a recording already in progress is
    // still real captured content — stop and save it rather than silently
    // leaving it running with nothing to ever collect it. The presign is
    // reserved before restart-batch resets the session (same race as end).
    if (recordingStatusByBatch[batchId] === "recording") {
      let recordingPresign = null;
      try {
        recordingPresign = await reserveRecordingUpload(batchId);
      } catch {
        // stopRecordingForBatch will surface the upload failure
      }
      stopRecordingForBatch(batchId, recordingPresign, "restarted");
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
                class_mode: "Offline",
                meeting_link: null,
                meeting_provider: null,
                cancelled_at: null,
                students: b.students.map((s) => ({ ...s, already_present: false })),
              }
            : b
        ),
      }));
      setExpandedBatchId((prev) => (prev === batchId ? null : prev));
      setActiveOnlineCallByBatch((prev) => {
        const next = { ...prev };
        delete next[batchId];
        return next;
      });
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

  // Cancels a live online class — the join link stops working for every
  // student and any attendance marked so far is cleared server-side. The
  // BatchSession row itself survives (cancelled_at set, not deleted); if the
  // teacher wants a full do-over today, the existing Restart Class button
  // (still shown for a cancelled-but-not-ended session) already handles that.
  const cancelOnlineClass = async (batchId) => {
    if (
      !window.confirm(
        "Cancel this online class? Students won't be able to join, and any attendance already marked today for this batch will be cleared."
      )
    ) {
      return;
    }
    if (recordingStatusByBatch[batchId] === "recording") {
      let recordingPresign = null;
      try {
        recordingPresign = await reserveRecordingUpload(batchId);
      } catch {
        // stopRecordingForBatch will surface the upload failure
      }
      stopRecordingForBatch(batchId, recordingPresign, "cancelled");
    }
    setBatchCancellingId(batchId);
    try {
      await API.post("/teacher-auth/cancel-online-batch", { slug, batch_id: batchId });
      setDashboard((prev) => ({
        ...prev,
        todayBatches: prev.todayBatches.map((b) =>
          b.id === batchId
            ? {
                ...b,
                cancelled_at: new Date().toISOString(),
                students: b.students.map((s) => ({ ...s, already_present: false })),
              }
            : b
        ),
      }));
      setActiveOnlineCallByBatch((prev) => {
        const next = { ...prev };
        delete next[batchId];
        return next;
      });
      setToast({ variant: "success", message: "Online class cancelled." });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to cancel the class.",
      });
    } finally {
      setBatchCancellingId(null);
    }
  };

  // Lets the teacher enter their own live Online class from inside this
  // page — mints a fresh moderator token, then renders the embedded call.
  const joinOnlineClassAsTeacher = async (batchId) => {
    setJoiningCallId(batchId);
    try {
      const response = await API.post("/teacher-auth/online-class/moderator-token", {
        slug,
        batch_id: batchId,
      });
      setActiveOnlineCallByBatch((prev) => ({ ...prev, [batchId]: response.data.data }));
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Couldn't join the class.",
      });
    } finally {
      setJoiningCallId(null);
    }
  };

  const startRecordingForBatch = async (batchId) => {
    try {
      const recorder = createCallRecorder();
      await recorder.start();
      recordersRef.current[batchId] = recorder;
      setRecordingStatusByBatch((prev) => ({ ...prev, [batchId]: "recording" }));
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.message || "Couldn't start recording — check screen-share permission.",
      });
    }
  };

  // Reserved while the session is still "live" server-side — must happen
  // before end/restart/cancel changes session state, or the presign
  // endpoint's live-session check rejects it (the recorder can still be
  // flushing its final chunk well after the session-ending API returns).
  const reserveRecordingUpload = async (batchId) => {
    const presignRes = await API.post("/teacher-auth/online-class/recording/upload-url", {
      slug,
      batch_id: batchId,
    });
    return presignRes.data.data;
  };

  // Runs in the background — never awaited by the caller, so a slow S3
  // upload can't block the teacher from ending class. `presign`, when
  // provided, is one already reserved before the session was closed.
  // `stoppedReason` records what actually triggered the stop (ended /
  // restarted / cancelled / manual) so admins can tell a recording from a
  // properly finished class apart from a Restart/Cancel leftover.
  const uploadRecording = async (batchId, blob, durationSeconds, presign, stoppedReason) => {
    try {
      const { upload_url, s3_key } = presign || (await reserveRecordingUpload(batchId));
      await fetch(upload_url, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": "video/webm" },
      });
      await API.post("/teacher-auth/online-class/recording/complete", {
        slug,
        batch_id: batchId,
        s3_key,
        duration_seconds: durationSeconds,
        file_size_mb: blob.size / (1024 * 1024),
        stopped_reason: stoppedReason || "manual",
      });
      setToast({ variant: "success", message: "Recording saved." });
    } catch {
      setToast({
        variant: "danger",
        message: "Recording upload failed — the class itself is unaffected.",
      });
    } finally {
      setRecordingStatusByBatch((prev) => {
        const next = { ...prev };
        delete next[batchId];
        return next;
      });
    }
  };

  const stopRecordingForBatch = (batchId, presign, stoppedReason) => {
    const recorder = recordersRef.current[batchId];
    if (!recorder) return;
    delete recordersRef.current[batchId];
    setRecordingStatusByBatch((prev) => ({ ...prev, [batchId]: "uploading" }));
    recorder
      .stop()
      .then(({ blob, durationSeconds }) =>
        uploadRecording(batchId, blob, durationSeconds, presign, stoppedReason)
      )
      .catch(() => {
        setToast({ variant: "danger", message: "Couldn't finish recording." });
        setRecordingStatusByBatch((prev) => {
          const next = { ...prev };
          delete next[batchId];
          return next;
        });
      });
  };

  // Generates one student's join link on demand and copies it — never
  // pre-generated in bulk. Reuses the same clipboard-with-HTTPS-fallback
  // pattern as TeacherManagement.jsx's copyLoginLink, since navigator.clipboard
  // requires a secure context and this app is also served over plain HTTP.
  const copyStudentJoinLink = async (batchId, admissionId, studentName) => {
    const key = `${batchId}-${admissionId}`;
    setCopyingLinkFor(key);
    try {
      const response = await API.post("/teacher-auth/online-class/generate-link", {
        slug,
        batch_id: batchId,
        admission_id: admissionId,
      });
      const link = `${window.location.origin}/online-class/join/${response.data.data.token}`;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(link);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = link;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          const copied = document.execCommand("copy");
          document.body.removeChild(textarea);
          if (!copied) throw new Error("execCommand copy failed");
        }
        setToast({ variant: "success", message: `Join link copied for ${studentName}` });
      } catch {
        setToast({ variant: "danger", message: link });
      }
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to generate the join link.",
      });
    } finally {
      setCopyingLinkFor(null);
    }
  };

  const fetchOldTopicOptions = async (batchId) => {
    try {
      const response = await API.get(`/teacher-auth/batch-topics/${batchId}`);
      setOldTopicOptions(response.data.data || []);
    } catch {
      setOldTopicOptions([]);
    }
  };

  // The batch already has a fixed schedule (e.g. "8:00 AM - 12:00 PM"), so
  // Start/End Time can default to it instead of starting blank each time.
  const getBatchDefaultTiming = (batchId) => {
    const batch = batchProgress.find((b) => b.id === batchId);
    const [rawStart, rawEnd] = (batch?.timing || "").split(" - ").map((s) => s.trim());
    return {
      start_time: rawStart ? rawStart.toLowerCase() : "",
      end_time: rawEnd ? rawEnd.toLowerCase() : "",
    };
  };

  const openAddSessionForm = (batchId) => {
    setAddSessionError("");
    setAddSessionBatchId(batchId);
    setAddSessionForms([blankSessionFormCard(getBatchDefaultTiming(batchId))]);
    fetchOldTopicOptions(batchId);
  };

  const closeAddSessionForm = () => {
    setAddSessionBatchId(null);
    setAddSessionForms([]);
    setAddSessionError("");
    setCardErrors({});
    setCardSubmittingKeys({});
  };

  const addAnotherSessionFormCard = () => {
    setAddSessionForms((prev) => [
      ...prev,
      blankSessionFormCard(getBatchDefaultTiming(addSessionBatchId)),
    ]);
  };

  const removeSessionFormCard = (key) => {
    setAddSessionForms((prev) => prev.filter((card) => card.key !== key));
  };

  const updateSessionFormCard = (key, field, value) => {
    setAddSessionForms((prev) =>
      prev.map((card) => (card.key === key ? { ...card, [field]: value } : card))
    );
  };

  const toggleAddSessionPresentId = (key, studentId) => {
    setAddSessionForms((prev) =>
      prev.map((card) => {
        if (card.key !== key) return card;
        const current = card.attendance[studentId];
        const attendance = { ...card.attendance };
        if (current?.present) {
          attendance[studentId] = { present: false, in_time: "", out_time: "" };
        } else {
          // In/Out defaults to the class's own Start/End Time — the teacher
          // can still edit either one per student if it was different.
          attendance[studentId] = {
            present: true,
            in_time: current?.in_time || card.start_time,
            out_time: current?.out_time || card.end_time,
          };
        }
        return { ...card, attendance };
      })
    );
  };

  const updateAddSessionStudentTime = (key, studentId, field, value) => {
    setAddSessionForms((prev) =>
      prev.map((card) =>
        card.key !== key
          ? card
          : {
              ...card,
              attendance: {
                ...card.attendance,
                [studentId]: { ...card.attendance[studentId], [field]: value },
              },
            }
      )
    );
  };

  const openEditSessionForm = (batchId, session) => {
    setSessionFormError("");
    const startTime = formatTime12(session.started_at);
    const endTime = formatTime12(session.ended_at);
    const attendance = {};
    session.present.forEach((s) => {
      attendance[s.id] = {
        present: true,
        in_time: formatTime12(s.in_time) || startTime,
        out_time: formatTime12(s.out_time) || endTime,
      };
    });
    session.absent.forEach((s) => {
      attendance[s.id] = { present: false, in_time: "", out_time: "" };
    });
    setSessionForm({
      batchId,
      sessionId: session.id,
      date: session.date,
      start_time: startTime,
      end_time: endTime,
      topic_covered: session.topic_covered || "",
      attendance,
    });
    fetchOldTopicOptions(batchId);
  };

  const closeSessionForm = () => {
    setSessionForm(null);
    setSessionFormError("");
  };

  // Checking a student in defaults their in/out time to the class's own
  // start/end time — convenient when everyone arrived on time, but each
  // student's times stay independently editable for anyone who didn't.
  const toggleSessionPresentId = (id) => {
    setSessionForm((prev) => {
      const current = prev.attendance[id];
      const attendance = { ...prev.attendance };
      if (current?.present) {
        attendance[id] = { present: false, in_time: "", out_time: "" };
      } else {
        attendance[id] = {
          present: true,
          in_time: current?.in_time || prev.start_time,
          out_time: current?.out_time || prev.end_time,
        };
      }
      return { ...prev, attendance };
    });
  };

  const updateSessionStudentTime = (id, field, value) => {
    setSessionForm((prev) => ({
      ...prev,
      attendance: {
        ...prev.attendance,
        [id]: { ...prev.attendance[id], [field]: value },
      },
    }));
  };

  const refreshBatchProgress = async () => {
    try {
      const response = await API.get(`/teacher-auth/batch-progress/${slug}`);
      setBatchProgress(response.data.data);
    } catch {
      // Keep whatever's already on screen if the refresh itself fails.
    }
  };

  const refreshDashboard = async () => {
    try {
      const response = await API.get(`/teacher-auth/dashboard/${slug}`);
      setDashboard(response.data.data);
    } catch {
      // Keep whatever's already on screen if the refresh itself fails.
    }
  };

  // ---- Own batch create/edit/manage — only reachable when
  // dashboard.teacher.can_create_batches is true ----

  const fetchOwnBatchSubjects = async () => {
    try {
      const response = await API.get("/teacher-auth/subjects");
      setOwnBatchSubjects(response.data.data || []);
    } catch {
      setOwnBatchSubjects([]);
    }
  };

  const fetchOwnBatchStudentOptions = async (subjectId) => {
    if (!subjectId) {
      setOwnBatchStudentOptions([]);
      return;
    }
    try {
      const response = await API.get("/teacher-auth/batches/subject-students", {
        params: { subjectId },
      });
      setOwnBatchStudentOptions(response.data.data || []);
    } catch {
      setOwnBatchStudentOptions([]);
    }
  };

  const openCreateOwnBatchForm = () => {
    setOwnBatchForm(blankOwnBatchForm());
    setOwnBatchSelectedStudentIds([]);
    setOwnBatchStudentOptions([]);
    setOwnBatchErrors({});
    setOwnStudentTimingTab("match");
    if (ownBatchSubjects.length === 0) fetchOwnBatchSubjects();
  };

  const openEditOwnBatchForm = (bp) => {
    setOwnStudentTimingTab("match");
    // bp comes from batchProgress — it has subject_name (not subject_id)
    // and a combined "start - end" timing string, so both need reversing
    // back into the form's separate fields.
    const [start, end] = (bp.timing || "").split(" - ").map((s) => s.trim());
    const subject = ownBatchSubjects.find((s) => s.subject_name === bp.subject_name);
    setOwnBatchForm({
      id: bp.id,
      batch_name: bp.batch_name,
      section: bp.section,
      subject_id: subject ? subject.id : "",
      start_time: start ? start.toLowerCase() : "",
      end_time: end ? end.toLowerCase() : "",
      num_days: bp.num_days ?? "",
    });
    setOwnBatchSelectedStudentIds((bp.students || []).map((s) => s.id));
    setOwnBatchErrors({});
    if (ownBatchSubjects.length === 0) fetchOwnBatchSubjects();
    if (subject) fetchOwnBatchStudentOptions(subject.id);
  };

  const closeOwnBatchForm = () => {
    setOwnBatchForm(null);
    setOwnBatchErrors({});
  };

  const handleOwnBatchSubjectChange = (subjectId) => {
    setOwnBatchForm((prev) => ({ ...prev, subject_id: subjectId }));
    setOwnBatchSelectedStudentIds([]);
    setOwnStudentTimingTab("match");
    fetchOwnBatchStudentOptions(subjectId);
  };

  const toggleOwnBatchStudent = (admissionId) => {
    setOwnBatchSelectedStudentIds((prev) =>
      prev.includes(admissionId)
        ? prev.filter((id) => id !== admissionId)
        : [...prev, admissionId]
    );
  };

  const submitOwnBatch = async () => {
    if (!ownBatchForm) return;
    const { id, batch_name, section, subject_id, start_time, end_time, num_days } = ownBatchForm;
    const errors = {};
    if (!batch_name.trim()) errors.batch_name = "Batch Name is required.";
    if (!section) errors.section = "Section is required.";
    if (!subject_id) errors.subject_id = "Subject is required.";
    if (!TIME_12H_PATTERN.test(start_time) || !TIME_12H_PATTERN.test(end_time)) {
      errors.timing = 'Start/End time must look like "8:00 am" or "12:00 pm".';
    }
    if (Object.keys(errors).length > 0) {
      setOwnBatchErrors(errors);
      return;
    }
    setOwnBatchSubmitting(true);
    setOwnBatchErrors({});
    try {
      const payload = {
        batch_name: batch_name.trim(),
        section,
        subject_id,
        timing: `${start_time} - ${end_time}`,
        num_days: num_days === "" ? null : num_days,
        admission_ids: ownBatchSelectedStudentIds,
      };
      if (id) {
        await API.put(`/teacher-auth/batches/${id}`, payload);
      } else {
        await API.post("/teacher-auth/batches", payload);
      }
      closeOwnBatchForm();
      await Promise.all([refreshBatchProgress(), refreshDashboard()]);
      setToast({ variant: "success", message: id ? "Batch updated." : "Batch created." });
    } catch (err) {
      if (err.response?.data?.errors) {
        setOwnBatchErrors(err.response.data.errors);
      } else {
        setOwnBatchErrors({ general: err.response?.data?.message || "Failed to save batch." });
      }
    } finally {
      setOwnBatchSubmitting(false);
    }
  };

  const handleDeleteOwnBatch = async (batchId) => {
    if (!window.confirm("Delete this batch? This can't be undone.")) return;
    setDeletingOwnBatchId(batchId);
    try {
      await API.delete(`/teacher-auth/batches/${batchId}`);
      await Promise.all([refreshBatchProgress(), refreshDashboard()]);
      setToast({ variant: "success", message: "Batch removed." });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to delete batch.",
      });
    } finally {
      setDeletingOwnBatchId(null);
    }
  };

  const submitSessionForm = async () => {
    if (!sessionForm) return;
    const { batchId, sessionId, date, start_time, end_time, topic_covered, attendance } = sessionForm;
    if (!date || !start_time || !end_time || !topic_covered.trim()) {
      setSessionFormError("Date, start time, end time and topic are all required.");
      return;
    }
    if (!TIME_12H_PATTERN.test(start_time) || !TIME_12H_PATTERN.test(end_time)) {
      setSessionFormError('Start/End time must look like "8:00 am" or "12:00 pm".');
      return;
    }
    const presentEntries = Object.entries(attendance).filter(([, v]) => v.present);
    for (const [, v] of presentEntries) {
      if (v.in_time && !TIME_12H_PATTERN.test(v.in_time)) {
        setSessionFormError('In/Out time must look like "8:00 am" or "12:00 pm".');
        return;
      }
      if (v.out_time && !TIME_12H_PATTERN.test(v.out_time)) {
        setSessionFormError('In/Out time must look like "8:00 am" or "12:00 pm".');
        return;
      }
    }
    setSessionFormSubmitting(true);
    setSessionFormError("");
    try {
      const presentStudents = presentEntries.map(([admission_id, v]) => ({
        admission_id: Number(admission_id),
        in_time: v.in_time ? to24HourTime(v.in_time) : null,
        out_time: v.out_time ? to24HourTime(v.out_time) : null,
      }));
      const payload = {
        date,
        start_time: to24HourTime(start_time),
        end_time: to24HourTime(end_time),
        topic_covered: topic_covered.trim(),
        present_students: presentStudents,
      };
      if (sessionId) {
        await API.put(`/teacher-auth/session/${sessionId}`, payload);
      } else {
        await API.post("/teacher-auth/session/add", { batch_id: batchId, ...payload });
      }
      closeSessionForm();
      await refreshBatchProgress();
      setToast({ variant: "success", message: sessionId ? "Class updated." : "Class added." });
    } catch (err) {
      setSessionFormError(err.response?.data?.message || "Failed to save.");
    } finally {
      setSessionFormSubmitting(false);
    }
  };

  const submitAddSessionForms = async () => {
    if (!addSessionBatchId || addSessionForms.length === 0) return;
    for (const card of addSessionForms) {
      if (!card.date || !card.start_time || !card.end_time || !card.topic_covered.trim()) {
        setAddSessionError("Date, start time, end time and topic are required for every class.");
        return;
      }
      if (!TIME_12H_PATTERN.test(card.start_time) || !TIME_12H_PATTERN.test(card.end_time)) {
        setAddSessionError('Start/End time must look like "8:00 am" or "12:00 pm".');
        return;
      }
      for (const v of Object.values(card.attendance)) {
        if (!v.present) continue;
        if (v.in_time && !TIME_12H_PATTERN.test(v.in_time)) {
          setAddSessionError('In/Out time must look like "8:00 am" or "12:00 pm".');
          return;
        }
        if (v.out_time && !TIME_12H_PATTERN.test(v.out_time)) {
          setAddSessionError('In/Out time must look like "8:00 am" or "12:00 pm".');
          return;
        }
      }
    }
    setAddSessionSubmitting(true);
    setAddSessionError("");
    try {
      await Promise.all(
        addSessionForms.map((card) => {
          const presentStudents = Object.entries(card.attendance)
            .filter(([, v]) => v.present)
            .map(([admission_id, v]) => ({
              admission_id: Number(admission_id),
              in_time: v.in_time ? to24HourTime(v.in_time) : null,
              out_time: v.out_time ? to24HourTime(v.out_time) : null,
            }));
          return API.post("/teacher-auth/session/add", {
            batch_id: addSessionBatchId,
            date: card.date,
            start_time: to24HourTime(card.start_time),
            end_time: to24HourTime(card.end_time),
            topic_covered: card.topic_covered.trim(),
            present_students: presentStudents,
          });
        })
      );
      const count = addSessionForms.length;
      closeAddSessionForm();
      await refreshBatchProgress();
      setToast({
        variant: "success",
        message: count === 1 ? "Class added." : `${count} classes added.`,
      });
    } catch (err) {
      setAddSessionError(err.response?.data?.message || "Failed to save one or more classes.");
    } finally {
      setAddSessionSubmitting(false);
    }
  };

  // Saves just this one card so it can be checked and committed on its own,
  // instead of waiting to submit every card in the panel together.
  const submitSingleSessionCard = async (card) => {
    if (!card.date || !card.start_time || !card.end_time || !card.topic_covered.trim()) {
      setCardErrors((prev) => ({
        ...prev,
        [card.key]: "Date, start time, end time and topic are all required.",
      }));
      return;
    }
    if (!TIME_12H_PATTERN.test(card.start_time) || !TIME_12H_PATTERN.test(card.end_time)) {
      setCardErrors((prev) => ({
        ...prev,
        [card.key]: 'Start/End time must look like "8:00 am" or "12:00 pm".',
      }));
      return;
    }
    for (const v of Object.values(card.attendance)) {
      if (!v.present) continue;
      if (
        (v.in_time && !TIME_12H_PATTERN.test(v.in_time)) ||
        (v.out_time && !TIME_12H_PATTERN.test(v.out_time))
      ) {
        setCardErrors((prev) => ({
          ...prev,
          [card.key]: 'In/Out time must look like "8:00 am" or "12:00 pm".',
        }));
        return;
      }
    }
    setCardErrors((prev) => ({ ...prev, [card.key]: "" }));
    setCardSubmittingKeys((prev) => ({ ...prev, [card.key]: true }));
    try {
      const presentStudents = Object.entries(card.attendance)
        .filter(([, v]) => v.present)
        .map(([admission_id, v]) => ({
          admission_id: Number(admission_id),
          in_time: v.in_time ? to24HourTime(v.in_time) : null,
          out_time: v.out_time ? to24HourTime(v.out_time) : null,
        }));
      await API.post("/teacher-auth/session/add", {
        batch_id: addSessionBatchId,
        date: card.date,
        start_time: to24HourTime(card.start_time),
        end_time: to24HourTime(card.end_time),
        topic_covered: card.topic_covered.trim(),
        present_students: presentStudents,
      });
      setAddSessionForms((prev) => prev.filter((c) => c.key !== card.key));
      setCardErrors((prev) => {
        const next = { ...prev };
        delete next[card.key];
        return next;
      });
      await refreshBatchProgress();
      setToast({ variant: "success", message: "Class added." });
    } catch (err) {
      setCardErrors((prev) => ({
        ...prev,
        [card.key]: err.response?.data?.message || "Failed to save this class.",
      }));
    } finally {
      setCardSubmittingKeys((prev) => {
        const next = { ...prev };
        delete next[card.key];
        return next;
      });
    }
  };

  const renderSessionFormPanel = (studentsForBatch) => {
    if (!sessionForm) return null;
    return (
      <div className="border rounded p-3 mb-2 bg-light">
        <div className="row g-2">
          <div className="col-md-3">
            <label className="form-label small mb-1">Date</label>
            <input
              type="date"
              className="form-control form-control-sm"
              max={new Date().toISOString().slice(0, 10)}
              value={sessionForm.date}
              onChange={(e) =>
                setSessionForm((prev) => ({ ...prev, date: e.target.value }))
              }
            />
          </div>
          <div className="col-md-3">
            <label className="form-label small mb-1">Start Time</label>
            <input
              type="text"
              className="form-control form-control-sm"
              placeholder="8:00 am"
              maxLength={8}
              value={sessionForm.start_time}
              onChange={(e) =>
                setSessionForm((prev) => ({
                  ...prev,
                  start_time: sanitizeTime12Input(e.target.value),
                }))
              }
            />
          </div>
          <div className="col-md-3">
            <label className="form-label small mb-1">End Time</label>
            <input
              type="text"
              className="form-control form-control-sm"
              placeholder="12:00 pm"
              maxLength={8}
              value={sessionForm.end_time}
              onChange={(e) =>
                setSessionForm((prev) => ({
                  ...prev,
                  end_time: sanitizeTime12Input(e.target.value),
                }))
              }
            />
          </div>
          <div className="col-md-3">
            <label className="form-label small mb-1">Use an already-covered topic</label>
            <select
              className="form-select form-select-sm"
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  setSessionForm((prev) => ({ ...prev, topic_covered: e.target.value }));
                }
              }}
            >
              <option value="">— pick one (optional) —</option>
              {oldTopicOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="col-12">
            <label className="form-label small mb-1">Topic Covered</label>
            <input
              type="text"
              className="form-control form-control-sm"
              placeholder="Type a topic, or pick one above"
              value={sessionForm.topic_covered}
              onChange={(e) =>
                setSessionForm((prev) => ({ ...prev, topic_covered: e.target.value }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label small mb-1 d-block">
              Who was present? (with their own in/out time)
            </label>
            {studentsForBatch.length === 0 ? (
              <div className="text-muted small">No students in this batch.</div>
            ) : (
              studentsForBatch.map((st) => {
                const entry = sessionForm.attendance[st.id];
                const isPresent = !!entry?.present;
                return (
                  <div
                    key={st.id}
                    className="d-flex align-items-center flex-wrap gap-2 border-bottom py-1"
                  >
                    <div className="form-check" style={{ minWidth: "160px" }}>
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={isPresent}
                        onChange={() => toggleSessionPresentId(st.id)}
                      />
                      <label className="form-check-label small">
                        {st.applicant_name}
                      </label>
                    </div>
                    {isPresent && (
                      <>
                        <div className="d-flex align-items-center gap-1">
                          <label className="small text-muted mb-0">In</label>
                          <input
                            type="text"
                            className="form-control form-control-sm"
                            style={{ width: "120px" }}
                            placeholder="8:00 am"
                            maxLength={8}
                            value={entry.in_time}
                            onChange={(e) =>
                              updateSessionStudentTime(
                                st.id,
                                "in_time",
                                sanitizeTime12Input(e.target.value)
                              )
                            }
                          />
                        </div>
                        <div className="d-flex align-items-center gap-1">
                          <label className="small text-muted mb-0">Out</label>
                          <input
                            type="text"
                            className="form-control form-control-sm"
                            style={{ width: "120px" }}
                            placeholder="12:00 pm"
                            maxLength={8}
                            value={entry.out_time}
                            onChange={(e) =>
                              updateSessionStudentTime(
                                st.id,
                                "out_time",
                                sanitizeTime12Input(e.target.value)
                              )
                            }
                          />
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
          {sessionFormError && (
            <div className="col-12">
              <div className="text-danger small">{sessionFormError}</div>
            </div>
          )}
          <div className="col-12 d-flex gap-2">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={sessionFormSubmitting}
              onClick={submitSessionForm}
            >
              {sessionFormSubmitting
                ? "Saving..."
                : sessionForm.sessionId
                  ? "Save Changes"
                  : "Add Class"}
            </button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={closeSessionForm}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderAddSessionFormPanel = (studentsForBatch) => {
    if (!addSessionBatchId) return null;
    return (
      <div className="border rounded p-3 mb-2 bg-light">
        {addSessionForms.map((card, idx) => (
          <div key={card.key} className="border rounded p-3 mb-2 bg-white">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold small">Class {idx + 1}</div>
              <div className="d-flex gap-1">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary py-0 px-2"
                  disabled={!!cardSubmittingKeys[card.key]}
                  onClick={() => submitSingleSessionCard(card)}
                >
                  {cardSubmittingKeys[card.key] ? "Saving..." : "Save"}
                </button>
                {addSessionForms.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger py-0 px-1"
                    title="Remove this class"
                    onClick={() => removeSessionFormCard(card.key)}
                  >
                    <i className="bi bi-trash"></i>
                  </button>
                )}
              </div>
            </div>
            <div className="row g-2">
              <div className="col-md-3">
                <label className="form-label small mb-1">Date</label>
                <input
                  type="date"
                  className="form-control form-control-sm"
                  max={new Date().toISOString().slice(0, 10)}
                  value={card.date}
                  onChange={(e) => updateSessionFormCard(card.key, "date", e.target.value)}
                />
              </div>
              <div className="col-md-3">
                <label className="form-label small mb-1">Start Time</label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="8:00 am"
                  maxLength={8}
                  value={card.start_time}
                  onChange={(e) =>
                    updateSessionFormCard(
                      card.key,
                      "start_time",
                      sanitizeTime12Input(e.target.value)
                    )
                  }
                />
              </div>
              <div className="col-md-3">
                <label className="form-label small mb-1">End Time</label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="12:00 pm"
                  maxLength={8}
                  value={card.end_time}
                  onChange={(e) =>
                    updateSessionFormCard(card.key, "end_time", sanitizeTime12Input(e.target.value))
                  }
                />
              </div>
              <div className="col-md-3">
                <label className="form-label small mb-1">Use an already-covered topic</label>
                <select
                  className="form-select form-select-sm"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      updateSessionFormCard(card.key, "topic_covered", e.target.value);
                    }
                  }}
                >
                  <option value="">— pick one (optional) —</option>
                  {oldTopicOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-12">
                <label className="form-label small mb-1">Topic Covered</label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="Type a topic, or pick one above"
                  value={card.topic_covered}
                  onChange={(e) =>
                    updateSessionFormCard(card.key, "topic_covered", e.target.value)
                  }
                />
              </div>
              <div className="col-12">
                <label className="form-label small mb-1 d-block">
                  Who was present? (with their own in/out time)
                </label>
                {studentsForBatch.length === 0 ? (
                  <div className="text-muted small">No students in this batch.</div>
                ) : (
                  studentsForBatch.map((st) => {
                    const entry = card.attendance[st.id];
                    const isPresent = !!entry?.present;
                    return (
                      <div
                        key={st.id}
                        className="d-flex align-items-center flex-wrap gap-2 border-bottom py-1"
                      >
                        <div className="form-check" style={{ minWidth: "160px" }}>
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={isPresent}
                            onChange={() => toggleAddSessionPresentId(card.key, st.id)}
                          />
                          <label className="form-check-label small">
                            {st.applicant_name}
                          </label>
                        </div>
                        {isPresent && (
                          <>
                            <div className="d-flex align-items-center gap-1">
                              <label className="small text-muted mb-0">In</label>
                              <input
                                type="text"
                                className="form-control form-control-sm"
                                style={{ width: "120px" }}
                                placeholder="8:00 am"
                                maxLength={8}
                                value={entry.in_time}
                                onChange={(e) =>
                                  updateAddSessionStudentTime(
                                    card.key,
                                    st.id,
                                    "in_time",
                                    sanitizeTime12Input(e.target.value)
                                  )
                                }
                              />
                            </div>
                            <div className="d-flex align-items-center gap-1">
                              <label className="small text-muted mb-0">Out</label>
                              <input
                                type="text"
                                className="form-control form-control-sm"
                                style={{ width: "120px" }}
                                placeholder="12:00 pm"
                                maxLength={8}
                                value={entry.out_time}
                                onChange={(e) =>
                                  updateAddSessionStudentTime(
                                    card.key,
                                    st.id,
                                    "out_time",
                                    sanitizeTime12Input(e.target.value)
                                  )
                                }
                              />
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            {cardErrors[card.key] && (
              <div className="text-danger small mt-2">{cardErrors[card.key]}</div>
            )}
          </div>
        ))}
        <button
          type="button"
          className="btn btn-sm btn-outline-primary mb-2"
          onClick={addAnotherSessionFormCard}
        >
          <i className="bi bi-plus-lg me-1"></i>
          Add another class
        </button>
        {addSessionError && <div className="text-danger small mb-2">{addSessionError}</div>}
        <div className="d-flex gap-2">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={addSessionSubmitting}
            onClick={submitAddSessionForms}
          >
            {addSessionSubmitting
              ? "Saving..."
              : addSessionForms.length > 1
                ? "Add Classes"
                : "Add Class"}
          </button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={closeAddSessionForm}>
            Cancel
          </button>
        </div>
      </div>
    );
  };

  const handleDeleteSession = async (sessionId) => {
    if (!window.confirm("Delete this class entry? This removes its attendance record too.")) {
      return;
    }
    setDeletingSessionId(sessionId);
    try {
      await API.delete(`/teacher-auth/session/${sessionId}`);
      await refreshBatchProgress();
      setToast({ variant: "success", message: "Class entry deleted." });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to delete.",
      });
    } finally {
      setDeletingSessionId(null);
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
                            <span
                              className={`badge ms-2 ${b.created_by_teacher_id ? "bg-primary-subtle text-primary" : "bg-secondary-subtle text-secondary"}`}
                            >
                              {b.created_by_teacher_id ? "Own Creation" : "Created by Admin"}
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
                                {b.started_at && b.class_mode === "Online" && !b.cancelled_at && (
                                  <span className="badge bg-info text-dark">
                                    <i className="bi bi-camera-video me-1"></i>
                                    Online
                                  </span>
                                )}
                                {b.cancelled_at && (
                                  <span className="badge bg-danger">
                                    <i className="bi bi-x-circle me-1"></i>
                                    Cancelled
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
                                  !b.cancelled_at &&
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
                                        {b.class_mode === "Online" && !activeOnlineCallByBatch[b.id] && (
                                          <button
                                            type="button"
                                            className="btn btn-sm btn-primary"
                                            disabled={joiningCallId === b.id}
                                            onClick={() => joinOnlineClassAsTeacher(b.id)}
                                          >
                                            <i className="bi bi-camera-video me-1"></i>
                                            {joiningCallId === b.id ? "Joining..." : "Join Class"}
                                          </button>
                                        )}
                                        {b.class_mode === "Online" && (
                                          <button
                                            type="button"
                                            className="btn btn-sm btn-outline-warning"
                                            disabled={batchCancellingId === b.id}
                                            title="Cancel this online class — students won't be able to join."
                                            onClick={() => cancelOnlineClass(b.id)}
                                          >
                                            {batchCancellingId === b.id ? "Cancelling..." : "Cancel Online Class"}
                                          </button>
                                        )}
                                        {activeOnlineCallByBatch[b.id] &&
                                          !recordingStatusByBatch[b.id] && (
                                            <button
                                              type="button"
                                              className="btn btn-sm btn-outline-danger"
                                              onClick={() => startRecordingForBatch(b.id)}
                                            >
                                              <i className="bi bi-record-circle me-1"></i>
                                              Start Recording
                                            </button>
                                          )}
                                        {recordingStatusByBatch[b.id] === "recording" && (
                                          <button
                                            type="button"
                                            className="btn btn-sm btn-danger"
                                            onClick={() => stopRecordingForBatch(b.id, null, "manual")}
                                          >
                                            <i className="bi bi-stop-circle me-1"></i>
                                            Stop Recording
                                          </button>
                                        )}
                                        {recordingStatusByBatch[b.id] === "uploading" && (
                                          <span className="badge bg-secondary">
                                            <span
                                              className="spinner-border spinner-border-sm me-1"
                                              role="status"
                                            ></span>
                                            Saving recording...
                                          </span>
                                        )}
                                      </>
                                    );
                                  })()}
                                {activeOnlineCallByBatch[b.id] && (
                                  <div className="w-100 mt-2" style={{ height: "480px" }}>
                                    <JitsiMeeting
                                      domain={activeOnlineCallByBatch[b.id].jitsi_domain}
                                      roomName={activeOnlineCallByBatch[b.id].room}
                                      jwt={activeOnlineCallByBatch[b.id].jitsi_token}
                                      configOverwrite={{ prejoinPageEnabled: true }}
                                      getIFrameRef={(iframeRef) => {
                                        iframeRef.style.height = "100%";
                                        iframeRef.style.width = "100%";
                                      }}
                                    />
                                  </div>
                                )}
                                {b.started_at && !b.ended_at && (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline-secondary"
                                    disabled={batchRestartingId === b.id}
                                    title="Undo this class — clears any attendance marked today and lets you start over."
                                    onClick={() => restartBatch(b.id)}
                                  >
                                    {batchRestartingId === b.id ? "Restarting..." : "Restart Class"}
                                  </button>
                                )}
                              </div>
                            )}
                            {!b.started_at && batchTopicPickerId === b.id && (
                              <div className="border rounded p-2 mt-2">
                                {dashboard.teacher?.can_host_online_classes && (
                                  <div className="mb-2">
                                    <div className="small fw-semibold mb-1">Class mode</div>
                                    <div className="btn-group btn-group-sm mb-2" role="group">
                                      <button
                                        type="button"
                                        className={`btn ${
                                          (onlineModeByBatch[b.id] || "Offline") === "Offline"
                                            ? "btn-primary"
                                            : "btn-outline-primary"
                                        }`}
                                        onClick={() =>
                                          setOnlineModeByBatch((prev) => ({ ...prev, [b.id]: "Offline" }))
                                        }
                                      >
                                        Offline
                                      </button>
                                      <button
                                        type="button"
                                        className={`btn ${
                                          onlineModeByBatch[b.id] === "Online"
                                            ? "btn-primary"
                                            : "btn-outline-primary"
                                        }`}
                                        onClick={() =>
                                          setOnlineModeByBatch((prev) => ({ ...prev, [b.id]: "Online" }))
                                        }
                                      >
                                        <i className="bi bi-camera-video me-1"></i>Online
                                      </button>
                                    </div>
                                    {onlineModeByBatch[b.id] === "Online" && (
                                      <div className="small text-muted mb-2">
                                        <i className="bi bi-shield-check me-1"></i>
                                        A secure class room is created automatically — no meeting link to set up.
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div className="small fw-semibold mb-2">
                                  What topic are you teaching today? (required to start)
                                </div>
                                {batchTopicSuggestionsLoading ? (
                                  <div className="text-muted small">Loading past topics...</div>
                                ) : (
                                  <>
                                    {(batchTopicSuggestions[b.id] || []).length > 0 && (
                                      <>
                                        <div className="text-muted small mb-1">
                                          Already covered — pick to repeat:
                                        </div>
                                        <div className="d-flex flex-wrap gap-2 mb-2">
                                          {batchTopicSuggestions[b.id].map((topic) => (
                                            <button
                                              key={topic}
                                              type="button"
                                              className="btn btn-sm btn-outline-primary"
                                              disabled={batchStartingId === b.id}
                                              onClick={() => startBatch(b.id, topic, onlineModeByBatch[b.id])}
                                            >
                                              {topic}
                                            </button>
                                          ))}
                                        </div>
                                      </>
                                    )}
                                    <div className="text-muted small mb-1">
                                      Or type today's new topic:
                                    </div>
                                    <div className="d-flex gap-2 flex-wrap align-items-start">
                                      <input
                                        type="text"
                                        className="form-control form-control-sm"
                                        style={{ maxWidth: "280px" }}
                                        placeholder="New topic name (required)"
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
                                        className="btn btn-sm btn-success"
                                        disabled={
                                          batchStartingId === b.id || !(batchTopicInputs[b.id] || "").trim()
                                        }
                                        onClick={() => {
                                          const topic = (batchTopicInputs[b.id] || "").trim();
                                          startBatch(b.id, topic, onlineModeByBatch[b.id]);
                                          setBatchTopicInputs((prev) => {
                                            const next = { ...prev };
                                            delete next[b.id];
                                            return next;
                                          });
                                        }}
                                      >
                                        {batchStartingId === b.id ? "Starting..." : "Start Class"}
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-secondary"
                                        onClick={() => {
                                          setBatchTopicPickerId(null);
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
                                      <div className="d-flex align-items-center gap-2">
                                        {b.class_mode === "Online" && !b.cancelled_at && (
                                          <button
                                            type="button"
                                            className="btn btn-sm btn-outline-info"
                                            disabled={copyingLinkFor === `${b.id}-${s.id}`}
                                            title="Copy this student's secure join link"
                                            onClick={() =>
                                              copyStudentJoinLink(b.id, s.id, s.applicant_name)
                                            }
                                          >
                                            {copyingLinkFor === `${b.id}-${s.id}` ? "..." : "Copy Link"}
                                          </button>
                                        )}
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
                                      {b.created_by_teacher_id && (
                                        <span
                                          className="badge bg-primary-subtle text-primary ms-1"
                                          style={{ fontSize: "0.65rem" }}
                                        >
                                          Own
                                        </span>
                                      )}
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
                              <span
                                className={`badge ms-2 ${bp.created_by_teacher_id ? "bg-primary-subtle text-primary" : "bg-secondary-subtle text-secondary"}`}
                              >
                                {bp.created_by_teacher_id ? "Own Creation" : "Created by Admin"}
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
                              <div className="d-flex justify-content-between align-items-center mb-2">
                                <div className="fw-semibold small">
                                  Covered Topics ({bp.sessions.length})
                                </div>
                                {addSessionBatchId !== bp.id && (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline-primary"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openAddSessionForm(bp.id);
                                    }}
                                  >
                                    <i className="bi bi-clock-history me-1"></i>
                                    Forgot Class
                                  </button>
                                )}
                              </div>
                              {addSessionBatchId === bp.id &&
                                renderAddSessionFormPanel(bp.students)}
                              {bp.sessions.length === 0 ? (
                                <div className="text-muted small">
                                  No topics recorded for this batch yet.
                                </div>
                              ) : (
                                bp.sessions.map((s) => {
                                  const sessionKey = `${bp.id}-${s.date}`;
                                  const isSessionOpen = expandedSessionKey === sessionKey;
                                  const isEditingThis =
                                    sessionForm && sessionForm.sessionId === s.id;
                                  if (isEditingThis) {
                                    return (
                                      <div key={sessionKey} className="mb-2">
                                        {renderSessionFormPanel(bp.students)}
                                      </div>
                                    );
                                  }
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
                                          <button
                                            type="button"
                                            className="btn btn-sm btn-outline-primary py-0 px-1"
                                            title="Edit this class"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              openEditSessionForm(bp.id, s);
                                            }}
                                          >
                                            <i className="bi bi-pencil"></i>
                                          </button>
                                          <button
                                            type="button"
                                            className="btn btn-sm btn-outline-danger py-0 px-1"
                                            title="Delete this class"
                                            disabled={deletingSessionId === s.id}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleDeleteSession(s.id);
                                            }}
                                          >
                                            <i className="bi bi-trash"></i>
                                          </button>
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

              {dashboard.teacher?.can_create_batches && (
                <div className="card shadow-sm mb-4">
                  <div className="card-body">
                    <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                      <h5 className="mb-0">My Batches — Create &amp; Manage</h5>
                      {!ownBatchForm && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={openCreateOwnBatchForm}
                        >
                          <i className="bi bi-plus-lg me-1"></i>
                          Create Batch
                        </button>
                      )}
                    </div>

                    {ownBatchForm && (
                      <div className="border rounded p-3 mb-3 bg-light">
                        <div className="row g-2">
                          <div className="col-md-6">
                            <label className="form-label small mb-1">Batch Name</label>
                            <input
                              type="text"
                              className={`form-control form-control-sm ${ownBatchErrors.batch_name ? "is-invalid" : ""}`}
                              value={ownBatchForm.batch_name}
                              onChange={(e) =>
                                setOwnBatchForm((p) => ({ ...p, batch_name: e.target.value }))
                              }
                            />
                            {ownBatchErrors.batch_name && (
                              <div className="invalid-feedback">{ownBatchErrors.batch_name}</div>
                            )}
                          </div>
                          <div className="col-md-6">
                            <label className="form-label small mb-1">Section</label>
                            <select
                              className={`form-select form-select-sm ${ownBatchErrors.section ? "is-invalid" : ""}`}
                              value={ownBatchForm.section}
                              onChange={(e) =>
                                setOwnBatchForm((p) => ({ ...p, section: e.target.value }))
                              }
                            >
                              <option value="">— select —</option>
                              {OWN_BATCH_SECTIONS.map((s) => (
                                <option key={s.key} value={s.key}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                            {ownBatchErrors.section && (
                              <div className="invalid-feedback">{ownBatchErrors.section}</div>
                            )}
                          </div>
                          <div className="col-md-6">
                            <label className="form-label small mb-1">Subject</label>
                            <select
                              className={`form-select form-select-sm ${ownBatchErrors.subject_id ? "is-invalid" : ""}`}
                              value={ownBatchForm.subject_id}
                              onChange={(e) => handleOwnBatchSubjectChange(e.target.value)}
                            >
                              <option value="">— select —</option>
                              {ownBatchSubjects.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.subject_name}
                                </option>
                              ))}
                            </select>
                            {ownBatchErrors.subject_id && (
                              <div className="invalid-feedback">{ownBatchErrors.subject_id}</div>
                            )}
                          </div>
                          <div className="col-md-2">
                            <label className="form-label small mb-1">Planned Days</label>
                            <input
                              type="number"
                              min="0"
                              className="form-control form-control-sm"
                              value={ownBatchForm.num_days}
                              onChange={(e) =>
                                setOwnBatchForm((p) => ({ ...p, num_days: e.target.value }))
                              }
                            />
                          </div>
                          <div className="col-md-2">
                            <label className="form-label small mb-1">Start Time</label>
                            <input
                              type="text"
                              className="form-control form-control-sm"
                              placeholder="8:00 am"
                              maxLength={8}
                              value={ownBatchForm.start_time}
                              onChange={(e) =>
                                setOwnBatchForm((p) => ({
                                  ...p,
                                  start_time: sanitizeTime12Input(e.target.value),
                                }))
                              }
                            />
                          </div>
                          <div className="col-md-2">
                            <label className="form-label small mb-1">End Time</label>
                            <input
                              type="text"
                              className="form-control form-control-sm"
                              placeholder="12:00 pm"
                              maxLength={8}
                              value={ownBatchForm.end_time}
                              onChange={(e) =>
                                setOwnBatchForm((p) => ({
                                  ...p,
                                  end_time: sanitizeTime12Input(e.target.value),
                                }))
                              }
                            />
                          </div>
                          {ownBatchErrors.timing && (
                            <div className="col-12">
                              <div className="text-danger small">{ownBatchErrors.timing}</div>
                            </div>
                          )}

                          <div className="col-12">
                            <label className="form-label small mb-1 d-block">Students</label>
                            {!ownBatchForm.subject_id ? (
                              <div className="text-muted small">
                                Select a Subject — admitted students for it will be listed
                                here.
                              </div>
                            ) : ownBatchStudentOptions.length === 0 ? (
                              <div className="text-muted small">
                                No admitted students found for this subject.
                              </div>
                            ) : (
                              (() => {
                                const studentsByTab = { match: [], different: [], unknown: [] };
                                ownBatchStudentOptions.forEach((a) => {
                                  const status = matchTimingStatus(
                                    a.timings,
                                    ownBatchTimingRange?.start,
                                    ownBatchTimingRange?.end
                                  );
                                  studentsByTab[status].push(a);
                                });
                                const activeStudents = studentsByTab[ownStudentTimingTab];
                                return (
                                  <>
                                    <div className="d-flex gap-2 mb-2 flex-wrap">
                                      {TIMING_STATUS_TABS.map((tab) => (
                                        <button
                                          key={tab.key}
                                          type="button"
                                          className={`btn btn-sm ${
                                            ownStudentTimingTab === tab.key
                                              ? tab.activeCls
                                              : tab.outlineCls
                                          }`}
                                          onClick={() => setOwnStudentTimingTab(tab.key)}
                                        >
                                          {tab.label} ({studentsByTab[tab.key].length})
                                        </button>
                                      ))}
                                    </div>
                                    <div
                                      className="border rounded p-2 row g-2"
                                      style={{ maxHeight: "220px", overflowY: "auto" }}
                                    >
                                      {activeStudents.length === 0 ? (
                                        <div className="text-muted small">
                                          No students in this category.
                                        </div>
                                      ) : (
                                        activeStudents.map((a) => (
                                          <div className="col-md-4" key={a.id}>
                                            <div className="form-check">
                                              <input
                                                className="form-check-input"
                                                type="checkbox"
                                                checked={ownBatchSelectedStudentIds.includes(
                                                  a.id
                                                )}
                                                onChange={() => toggleOwnBatchStudent(a.id)}
                                              />
                                              <label className="form-check-label small">
                                                {a.applicant_name}
                                                {a.comn_enrol_no && (
                                                  <span className="text-muted">
                                                    {" "}
                                                    ({a.comn_enrol_no})
                                                  </span>
                                                )}
                                              </label>
                                            </div>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  </>
                                );
                              })()
                            )}
                          </div>

                          {ownBatchErrors.general && (
                            <div className="col-12">
                              <div className="text-danger small">{ownBatchErrors.general}</div>
                            </div>
                          )}

                          <div className="col-12 d-flex gap-2 mt-2">
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              disabled={ownBatchSubmitting}
                              onClick={submitOwnBatch}
                            >
                              {ownBatchSubmitting
                                ? "Saving..."
                                : ownBatchForm.id
                                  ? "Save Changes"
                                  : "Create Batch"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={closeOwnBatchForm}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {(() => {
                      const myOwnBatches = batchProgress.filter(
                        (bp) => bp.created_by_teacher_id === dashboard.teacher?.id
                      );
                      return myOwnBatches.length === 0 ? (
                        <div className="text-muted small">
                          You haven't created any batches yet.
                        </div>
                      ) : (
                        myOwnBatches.map((bp) => (
                          <div
                            key={bp.id}
                            className="border rounded p-2 mb-2 d-flex justify-content-between align-items-center flex-wrap gap-2"
                          >
                            <div>
                              <strong>{bp.batch_name}</strong>
                              <span className="text-muted small ms-2">{bp.subject_name}</span>
                              <span className="badge bg-info text-dark ms-2">
                                {bp.section_label}
                              </span>
                              <div className="text-muted small">
                                <i className="bi bi-clock me-1"></i>
                                {bp.timing || "No timing set"}
                              </div>
                            </div>
                            <div className="d-flex gap-2">
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-primary"
                                title="Edit this batch"
                                onClick={() => openEditOwnBatchForm(bp)}
                              >
                                <i className="bi bi-pencil"></i>
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-danger"
                                title="Delete this batch"
                                disabled={deletingOwnBatchId === bp.id}
                                onClick={() => handleDeleteOwnBatch(bp.id)}
                              >
                                <i className="bi bi-trash"></i>
                              </button>
                            </div>
                          </div>
                        ))
                      );
                    })()}
                  </div>
                </div>
              )}

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
