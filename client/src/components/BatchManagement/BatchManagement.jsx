import { useEffect, useRef, useState } from "react";
import { Modal } from "bootstrap";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import API from "../../api/api";
import SubjectCompletionChart from "../SubjectCompletionChart/SubjectCompletionChart";

// A batch's Subject can itself be a sub-subject (has a Parent) — show both
// so "GST" alone doesn't get shown without the "Tally" (or whichever)
// subject it actually belongs to. Top-level subjects (no Parent) are
// unaffected — just their own name.
const subjectDisplayName = (subject) => {
  if (!subject) return null;
  return subject.Parent
    ? `${subject.Parent.subject_name} — ${subject.subject_name}`
    : subject.subject_name;
};

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

// --- Weekly Calendar View (Google-Calendar-style grid) ---
const CAL_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const CAL_DAYS_SUN_FIRST = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
// Same section/day mapping used on the teacher side (server/utils/sections.js).
const CAL_SECTION_DAYS = {
  fast_track: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  normal_mwf: ["Monday", "Wednesday", "Friday"],
  normal_tts: ["Tuesday", "Thursday", "Saturday"],
  weekend: ["Saturday"],
};

// YYYY-MM-DD from a Date's LOCAL fields — never use .toISOString() for this;
// that converts to UTC first, and for IST (+5:30) local midnight becomes
// 6:30pm the previous day in UTC, silently shifting every calendar date back
// by one. This is what the calendar view's day/week/month math must use.
const toLocalDateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// The batch's Number-of-Days duration, counted from the day it was added
// (created_at) over its section's actual class days — e.g. a 5-day Fast
// Track batch runs 5 straight calendar days; a 5-day Normal-MWF batch runs
// across its next 5 Mon/Wed/Fri occurrences. Returns the last date it's
// still active on, or null if there's nothing to compute (no num_days set).
const calendarBatchCutoffDate = (batch) => {
  if (!batch.num_days || !batch.created_at) return null;
  const activeDays = CAL_SECTION_DAYS[batch.section] || [];
  if (activeDays.length === 0) return null;
  const cur = new Date(batch.created_at);
  cur.setHours(0, 0, 0, 0);
  let count = 0;
  for (let i = 0; i < 3660; i++) {
    if (activeDays.includes(CAL_DAYS_SUN_FIRST[cur.getDay()])) {
      count++;
      if (count === batch.num_days) return toLocalDateStr(cur);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return null;
};

const calendarBatchActiveOnDate = (batch, dateStr) => {
  const createdDateStr = batch.created_at
    ? toLocalDateStr(new Date(batch.created_at))
    : null;
  if (createdDateStr && dateStr < createdDateStr) return false;
  const cutoff = calendarBatchCutoffDate(batch);
  if (cutoff && dateStr > cutoff) return false;
  return true;
};
const CAL_START_HOUR = 8; // 8 AM
const CAL_END_HOUR = 21; // 9 PM
const CAL_PX_PER_MIN = 1;
const CAL_COLORS = [
  "#3b82f6",
  "#ec4899",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#06b6d4",
  "#ef4444",
  "#84cc16",
];
const calendarColorForBatch = (id) => CAL_COLORS[id % CAL_COLORS.length];

// Minutes-since-midnight -> compact "5pm" / "5:30pm" style label, matching
// how Google Calendar shows event times in its month-view rows.
const formatCalTime = (mins) => {
  if (mins == null) return "";
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h}${ampm}` : `${h}:${String(m).padStart(2, "0")}${ampm}`;
};

// Parses "04:00 PM - 05:00 PM" into { start, end } minutes-since-midnight,
// for positioning a batch block on the calendar's vertical time axis.
const parseTimingRange = (timing) => {
  if (!timing) return null;
  const parts = timing.split(" - ").map((s) => s.trim());
  if (parts.length !== 2) return null;
  const parseOne = (str) => {
    const m = str.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!m) return null;
    return {
      hour: parseInt(m[1], 10),
      minute: parseInt(m[2], 10),
      ampm: m[3] ? m[3].toUpperCase() : null,
    };
  };
  const start = parseOne(parts[0]);
  const end = parseOne(parts[1]);
  if (!start || !end) return null;
  if (!start.ampm && end.ampm) start.ampm = end.ampm;
  if (!end.ampm && start.ampm) end.ampm = start.ampm;
  const to24 = (t) => {
    let h = t.hour;
    if (t.ampm === "PM" && h !== 12) h += 12;
    if (t.ampm === "AM" && h === 12) h = 0;
    return h * 60 + t.minute;
  };
  return { start: to24(start), end: to24(end) };
};

// Groups a day's batches into overlap clusters — batches that share any
// time overlap end up side-by-side in the same cluster/column-split.
// `dateForDay`, when given, additionally excludes batches whose num_days
// duration has finished by (or hasn't started by) that specific date.
const buildCalendarDayClusters = (batches, day, dateForDay) => {
  const dayBatches = batches
    .filter(
      (b) =>
        b.active &&
        b.timing &&
        (CAL_SECTION_DAYS[b.section] || []).includes(day) &&
        (!dateForDay || calendarBatchActiveOnDate(b, dateForDay))
    )
    .map((b) => ({ ...b, range: parseTimingRange(b.timing) }))
    .filter((b) => b.range)
    .sort((a, b) => a.range.start - b.range.start);

  const clusters = [];
  dayBatches.forEach((b) => {
    const cluster = clusters.find((c) =>
      c.some((e) => e.range.start < b.range.end && b.range.start < e.range.end)
    );
    if (cluster) cluster.push(b);
    else clusters.push([b]);
  });
  return clusters;
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
  const subjects = [...new Set(active.map((b) => subjectDisplayName(b.Subject)))].sort();
  const teachers = [...new Set(active.map((b) => b.Teacher.teacher_name))].sort();

  const bySubject = {};
  const byTeacher = {};
  timings.forEach((t) => {
    bySubject[t] = {};
    byTeacher[t] = {};
  });

  active.forEach((b) => {
    const t = b.timing;
    const subject = subjectDisplayName(b.Subject);
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
    { key: "fast_track", label: "Fast Track (Mon-Fri)" },
    { key: "normal_mwf", label: "Normal Track (Mon/Wed/Fri)" },
    { key: "normal_tts", label: "Normal Track (Tue/Thu/Sat)" },
    { key: "weekend", label: "Weekend (Saturday)" },
  ];
  const SECTION_LABEL_BY_KEY = Object.fromEntries(
    SECTIONS.map((s) => [s.key, s.label])
  );

  // --- Weekly Calendar View ---
  const calendarDetailModalRef = useRef(null);
  const [calendarExpanded, setCalendarExpanded] = useState({});
  const [calendarDetailBatch, setCalendarDetailBatch] = useState(null);

  const openCalendarBatchDetail = (batch) => {
    setCalendarDetailBatch(batch);
    Modal.getOrCreateInstance(calendarDetailModalRef.current).show();
  };

  const todayDateStr = toLocalDateStr(new Date());
  // "day" = single weekday column, "week" = full Mon-Sun grid, "month" = compact month grid.
  const [calendarViewMode, setCalendarViewMode] = useState("week");
  const [calendarFilterDate, setCalendarFilterDate] = useState(todayDateStr);

  const calendarDayForDate = (dateStr) => {
    const jsDay = new Date(`${dateStr}T00:00:00`).getDay();
    return CAL_DAYS_SUN_FIRST[jsDay];
  };
  const shiftCalendarDate = (dateStr, delta, unit = "day") => {
    const d = new Date(`${dateStr}T00:00:00`);
    if (unit === "month") d.setMonth(d.getMonth() + delta);
    else d.setDate(d.getDate() + delta);
    return toLocalDateStr(d);
  };
  // Day mode: +/-1 day. Week mode: +/-7 days. Month mode: +/-1 calendar
  // month, always landing on the 1st — stepping via setMonth() on the
  // current day-of-month would overflow on 31st-of-month dates (e.g.
  // Jan 31 -> Mar 3, silently skipping February).
  const handleCalendarStep = (delta) => {
    setCalendarFilterDate((d) => {
      if (calendarViewMode === "month") {
        const cur = new Date(`${d}T00:00:00`);
        const target = new Date(cur.getFullYear(), cur.getMonth() + delta, 1);
        return toLocalDateStr(target);
      }
      const step = calendarViewMode === "week" ? delta * 7 : delta;
      return shiftCalendarDate(d, step, "day");
    });
  };

  const calendarDaysToShow = calendarViewMode === "day" ? [calendarDayForDate(calendarFilterDate)] : CAL_DAYS;

  // Full week always resolves to real dates (Monday-start) around whatever
  // date is currently selected, purely so the num_days duration cutoff below
  // has an actual calendar date to compare against per column.
  const calendarWeekDates = (() => {
    const anchor = new Date(`${calendarFilterDate}T00:00:00`);
    const jsDay = anchor.getDay();
    const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay;
    const monday = new Date(anchor);
    monday.setDate(anchor.getDate() + mondayOffset);
    const dates = {};
    CAL_DAYS.forEach((day, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      dates[day] = toLocalDateStr(d);
    });
    return dates;
  })();

  const calendarMonthGrid = (() => {
    const anchor = new Date(`${calendarFilterDate}T00:00:00`);
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = firstOfMonth.getDay(); // Sunday-start grid
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(firstOfMonth.getDate() - startOffset);
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      cells.push({
        dateStr: toLocalDateStr(d),
        dayNum: d.getDate(),
        inCurrentMonth: d.getMonth() === month,
      });
    }
    return cells;
  })();

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


  const filteredBatchesTable = batches.filter((b) => {
    if (!batchSearchTerm.trim()) return true;
    const term = batchSearchTerm.toLowerCase();
    if ((b.batch_name || "").toLowerCase().includes(term)) return true;
    if ((b.Teacher?.teacher_name || "").toLowerCase().includes(term)) return true;
    if ((subjectDisplayName(b.Subject) || "").toLowerCase().includes(term)) return true;
    return (SECTION_LABEL_BY_KEY[b.section] || "").toLowerCase().includes(term);
  });

  const sortedBatchesTable = [...filteredBatchesTable].sort((a, b) => {
    const valA =
      batchSortField === "teacher"
        ? a.Teacher?.teacher_name || ""
        : batchSortField === "subject"
          ? subjectDisplayName(a.Subject) || ""
          : a[batchSortField] ?? "";
    const valB =
      batchSortField === "teacher"
        ? b.Teacher?.teacher_name || ""
        : batchSortField === "subject"
          ? subjectDisplayName(b.Subject) || ""
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
  // Flat list of every sub-subject across every subject — lets the admin
  // jump straight to a specific chapter (e.g. "Point of Sales") without
  // first picking its parent Subject. Only used when no Subject is chosen;
  // picking a Subject narrows back down to just its own children above.
  const allSubSubjects = subjects.flatMap((s) =>
    (s.SubSubjects || []).map((sub) => ({ ...sub, parent_subject_name: s.subject_name }))
  );
  const batchSubSubjectOptions = batchForm.subject_id ? batchSubSubjects : allSubSubjects;
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
    if (!batchForm.subject_id && !batchForm.sub_subject_id) {
      errors.subject_id = "Select a Subject or a Sub-Subject.";
    } else if (
      batchForm.subject_id &&
      batchSubSubjects.length > 0 &&
      !batchForm.sub_subject_id
    ) {
      errors.sub_subject_id = "Sub-Subject is required.";
    }
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
  const [sectionFilters, setSectionFilters] = useState({});

  const getSectionFilter = (key) =>
    sectionFilters[key] || { teacher: "", subject: "", startTime: "", endTime: "" };

  const updateSectionFilter = (key, field, value) => {
    setSectionFilters((prev) => ({
      ...prev,
      [key]: { ...getSectionFilter(key), [field]: value },
    }));
  };

  const clearSectionFilter = (key) => {
    setSectionFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

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
                const sectionBatchesAll = batches.filter(
                  (b) => b.section === section.key
                );
                const sectionTeacherOptions = [
                  ...new Map(
                    sectionBatchesAll
                      .filter((b) => b.Teacher)
                      .map((b) => [b.Teacher.id, b.Teacher.teacher_name])
                  ).entries(),
                ];
                const sectionSubjectOptions = [
                  ...new Map(
                    sectionBatchesAll
                      .filter((b) => b.Subject)
                      .map((b) => [b.Subject.id, subjectDisplayName(b.Subject)])
                  ).entries(),
                ];
                const filter = getSectionFilter(section.key);
                const filterActive =
                  filter.teacher || filter.subject || filter.startTime || filter.endTime;
                const sectionBatches = sectionBatchesAll.filter((b) => {
                  if (filter.teacher && String(b.teacher_id) !== String(filter.teacher))
                    return false;
                  if (filter.subject && String(b.subject_id) !== String(filter.subject))
                    return false;
                  if (filter.startTime || filter.endTime) {
                    const range = parseTimingRange(b.timing);
                    if (!range) return false;
                    if (filter.startTime) {
                      const [fh, fm] = filter.startTime.split(":").map(Number);
                      if (range.start < fh * 60 + fm) return false;
                    }
                    if (filter.endTime) {
                      const [th, tm] = filter.endTime.split(":").map(Number);
                      if (range.end > th * 60 + tm) return false;
                    }
                  }
                  return true;
                });
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
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <h6 className="mb-0">{section.label}</h6>
                        {filterActive && (
                          <button
                            type="button"
                            className="btn btn-sm btn-link p-0 text-decoration-none"
                            onClick={() => clearSectionFilter(section.key)}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <div className="mb-2 d-flex flex-column gap-1">
                        <select
                          className="form-select form-select-sm"
                          value={filter.teacher}
                          onChange={(e) =>
                            updateSectionFilter(section.key, "teacher", e.target.value)
                          }
                        >
                          <option value="">All Teachers</option>
                          {sectionTeacherOptions.map(([id, name]) => (
                            <option key={id} value={id}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <select
                          className="form-select form-select-sm"
                          value={filter.subject}
                          onChange={(e) =>
                            updateSectionFilter(section.key, "subject", e.target.value)
                          }
                        >
                          <option value="">All Subjects</option>
                          {sectionSubjectOptions.map(([id, name]) => (
                            <option key={id} value={id}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <div className="d-flex gap-1">
                          <input
                            type="time"
                            className="form-control form-control-sm"
                            title="From start time"
                            value={filter.startTime}
                            onChange={(e) =>
                              updateSectionFilter(section.key, "startTime", e.target.value)
                            }
                          />
                          <input
                            type="time"
                            className="form-control form-control-sm"
                            title="Up to end time"
                            value={filter.endTime}
                            onChange={(e) =>
                              updateSectionFilter(section.key, "endTime", e.target.value)
                            }
                          />
                        </div>
                      </div>
                      <div
                        style={{ maxHeight: "520px", overflowY: "auto" }}
                        className="pe-1"
                      >
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
                              {subjectDisplayName(b.Subject) || "-"}
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
            <h4 className="mb-3">Weekly Calendar View</h4>
            <style>{`
              @keyframes calendarSlideFade {
                from { opacity: 0.35; transform: translateX(8px); }
                to { opacity: 1; transform: translateX(0); }
              }
              .calendar-slide-anim { animation: calendarSlideFade 0.18s ease-out; }
            `}</style>
            <div className="text-muted small mb-2">
              Click a batch to bring it forward when it overlaps another — click the{" "}
              <i className="bi bi-eye"></i> icon on it to see full details (students, teacher).
              A batch stops appearing once its "Number of Days" duration is used up.
            </div>

            <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
              <div className="btn-group btn-group-sm" role="group">
                {["day", "week", "month"].map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`btn ${calendarViewMode === mode ? "btn-primary" : "btn-outline-primary"}`}
                    onClick={() => setCalendarViewMode(mode)}
                  >
                    {mode[0].toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => setCalendarFilterDate(todayDateStr)}
              >
                Today
              </button>
              <input
                type="date"
                className="form-control form-control-sm"
                style={{ maxWidth: "160px" }}
                value={calendarFilterDate}
                onChange={(e) => e.target.value && setCalendarFilterDate(e.target.value)}
              />
              <span className="small text-muted">
                {calendarViewMode === "month"
                  ? new Date(`${calendarFilterDate}T00:00:00`).toLocaleDateString("en-IN", {
                      month: "long",
                      year: "numeric",
                    })
                  : calendarViewMode === "day"
                    ? `${calendarDayForDate(calendarFilterDate)} (${calendarFilterDate})`
                    : "This week"}
              </span>
            </div>

            <div className="d-flex align-items-stretch gap-2">
              <button
                type="button"
                className="btn btn-light border rounded-circle flex-shrink-0"
                style={{ width: "40px", height: "40px", alignSelf: "center" }}
                onClick={() => handleCalendarStep(-1)}
                title="Previous"
              >
                <i className="bi bi-chevron-left"></i>
              </button>

              <div
                className="flex-grow-1 calendar-slide-anim"
                style={{ minWidth: 0 }}
                key={`${calendarViewMode}-${calendarFilterDate}`}
              >
                {calendarViewMode === "month" ? (
                  <div className="border rounded" style={{ width: "100%" }}>
                    <div className="row g-0 text-center small fw-semibold bg-light border-bottom">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                        <div className="col p-1" key={d}>
                          {d}
                        </div>
                      ))}
                    </div>
                    {/* One explicit .row per week (7 cells each) — Bootstrap's
                        auto .col doesn't wrap after N items on its own, so a
                        single flat .row of 42 cells collapses onto one line. */}
                    {Array.from({ length: 6 }, (_, weekIdx) => (
                      <div className="row g-0" key={weekIdx}>
                        {calendarMonthGrid.slice(weekIdx * 7, weekIdx * 7 + 7).map((cell) => {
                          const dayName = calendarDayForDate(cell.dateStr);
                          // Adjacent-month padding cells stay blank — only the
                          // current month's own cells compute/show batches, so
                          // nothing "expired-looking" bleeds across the border.
                          const cellBatches = cell.inCurrentMonth
                            ? batches.filter(
                                (b) =>
                                  b.active &&
                                  (CAL_SECTION_DAYS[b.section] || []).includes(dayName) &&
                                  calendarBatchActiveOnDate(b, cell.dateStr)
                              )
                            : [];
                          const isToday = cell.dateStr === todayDateStr;
                          return (
                            <div
                              className="col p-1 border-end border-bottom overflow-hidden"
                              key={cell.dateStr}
                              role="button"
                              style={{
                                height: "100px",
                                background: isToday ? "#f4f8ff" : "transparent",
                              }}
                              onClick={() => {
                                setCalendarFilterDate(cell.dateStr);
                                setCalendarViewMode("day");
                              }}
                            >
                              <div className="mb-1" style={{ color: cell.inCurrentMonth ? "inherit" : "#ccc" }}>
                                {isToday ? (
                                  <span
                                    className="badge rounded-pill bg-primary"
                                    style={{ fontSize: "12px" }}
                                  >
                                    {cell.dayNum}
                                  </span>
                                ) : (
                                  <span className="small fw-semibold">{cell.dayNum}</span>
                                )}
                              </div>
                              {cellBatches.slice(0, 3).map((b) => {
                                const range = parseTimingRange(b.timing);
                                return (
                                  <div
                                    key={b.id}
                                    className="d-flex align-items-center gap-1 text-truncate mb-1"
                                    style={{ fontSize: "11px" }}
                                  >
                                    <span
                                      className="rounded-circle flex-shrink-0"
                                      style={{
                                        width: "7px",
                                        height: "7px",
                                        background: calendarColorForBatch(b.id),
                                      }}
                                    ></span>
                                    <span className="text-truncate">
                                      {range ? `${formatCalTime(range.start)} ` : ""}
                                      {b.batch_name}
                                    </span>
                                  </div>
                                );
                              })}
                              {cellBatches.length > 3 && (
                                <div className="text-muted" style={{ fontSize: "10px" }}>
                                  +{cellBatches.length - 3} more
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ overflowX: "auto", width: "100%" }}>
                    <div style={{ display: "flex", width: "100%" }}>
                      <div style={{ width: "56px", flexShrink: 0 }}>
                        <div style={{ height: "28px" }}></div>
                        {Array.from(
                          { length: CAL_END_HOUR - CAL_START_HOUR },
                          (_, i) => CAL_START_HOUR + i
                        ).map((hour) => (
                          <div
                            key={hour}
                            className="text-muted small text-end pe-2"
                            style={{ height: `${60 * CAL_PX_PER_MIN}px` }}
                          >
                            {hour % 12 === 0 ? 12 : hour % 12}
                            {hour < 12 ? "AM" : "PM"}
                          </div>
                        ))}
                      </div>
                      {calendarDaysToShow.map((day) => {
                        const dateForDay = calendarWeekDates[day];
                        const clusters = buildCalendarDayClusters(batches, day, dateForDay);
                        const dayHeight = (CAL_END_HOUR - CAL_START_HOUR) * 60 * CAL_PX_PER_MIN;
                        return (
                          <div key={day} style={{ flex: 1, minWidth: 0 }}>
                            <div className="text-center fw-semibold small" style={{ height: "28px" }}>
                              {day.slice(0, 3)}
                              {calendarViewMode === "week" && (
                                <span className="text-muted"> {dateForDay?.slice(8, 10)}</span>
                              )}
                            </div>
                            <div
                              className="border-start position-relative"
                              style={{
                                height: `${dayHeight}px`,
                                backgroundImage:
                                  "repeating-linear-gradient(to bottom, #eee, #eee 1px, transparent 1px, transparent 60px)",
                              }}
                            >
                              {clusters.map((cluster) => {
                                const expandedId = calendarExpanded[day];
                                const hasExpanded = cluster.some((m) => m.id === expandedId);
                                const widths = cluster.map((m) =>
                                  hasExpanded
                                    ? m.id === expandedId
                                      ? 100 - (cluster.length - 1) * 16
                                      : 16
                                    : 100 / cluster.length
                                );
                                let cum = 0;
                                const lefts = widths.map((w) => {
                                  const l = cum;
                                  cum += w;
                                  return l;
                                });
                                return cluster.map((m, mi) => {
                                  const top = (m.range.start - CAL_START_HOUR * 60) * CAL_PX_PER_MIN;
                                  const height = (m.range.end - m.range.start) * CAL_PX_PER_MIN;
                                  const isWide = widths[mi] >= 40;
                                  return (
                                    <div
                                      key={m.id}
                                      role="button"
                                      onClick={() =>
                                        cluster.length > 1 &&
                                        setCalendarExpanded((prev) => ({ ...prev, [day]: m.id }))
                                      }
                                      className="position-absolute text-white overflow-hidden"
                                      style={{
                                        top: `${top}px`,
                                        height: `${Math.max(height, 20)}px`,
                                        left: `${lefts[mi]}%`,
                                        width: `${widths[mi]}%`,
                                        background: calendarColorForBatch(m.id),
                                        borderRadius: "4px",
                                        padding: "2px 4px",
                                        fontSize: "11px",
                                        lineHeight: "1.2",
                                        border: "1px solid rgba(255,255,255,0.6)",
                                        zIndex: m.id === expandedId ? 2 : 1,
                                        cursor: cluster.length > 1 ? "pointer" : "default",
                                      }}
                                      title={`${m.batch_name} — ${subjectDisplayName(m.Subject) || ""}`}
                                    >
                                      {isWide && (
                                        <button
                                          type="button"
                                          className="btn btn-sm p-0 position-absolute top-0 end-0 text-white"
                                          style={{ fontSize: "11px", lineHeight: 1, marginTop: "2px", marginRight: "2px" }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openCalendarBatchDetail(m);
                                          }}
                                          title="View batch details"
                                        >
                                          <i className="bi bi-eye-fill"></i>
                                        </button>
                                      )}
                                      <div className="fw-semibold text-truncate">{m.batch_name}</div>
                                      {isWide && (
                                        <>
                                          <div className="text-truncate">{subjectDisplayName(m.Subject)}</div>
                                          <div className="text-truncate">{m.Teacher?.teacher_name}</div>
                                        </>
                                      )}
                                    </div>
                                  );
                                });
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                className="btn btn-light border rounded-circle flex-shrink-0"
                style={{ width: "40px", height: "40px", alignSelf: "center" }}
                onClick={() => handleCalendarStep(1)}
                title="Next"
              >
                <i className="bi bi-chevron-right"></i>
              </button>
            </div>
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
                        <td>{subjectDisplayName(b.Subject) || "-"}</td>
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

        <SubjectCompletionChart />

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
                  <div className="col-md-6">
                    <label className="form-label">Sub-Subject</label>
                    <select
                      name="sub_subject_id"
                      className={`form-select ${batchFormErrors.sub_subject_id ? "is-invalid" : ""}`}
                      value={batchForm.sub_subject_id}
                      onChange={handleBatchFormChange}
                    >
                      <option value="">-- Select Sub-Subject --</option>
                      {batchSubSubjectOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {batchForm.subject_id
                            ? s.subject_name
                            : `${s.subject_name} (${s.parent_subject_name})`}
                        </option>
                      ))}
                    </select>
                    {!batchForm.subject_id && (
                      <div className="form-text">
                        Pick directly from every sub-subject, or choose a Subject above to narrow this list.
                      </div>
                    )}
                    {batchFormErrors.sub_subject_id && (
                      <div className="invalid-feedback">{batchFormErrors.sub_subject_id}</div>
                    )}
                  </div>

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

      <div className="modal fade" tabIndex="-1" ref={calendarDetailModalRef}>
        <div className="modal-dialog modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{calendarDetailBatch?.batch_name}</h5>
              <button type="button" className="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div className="modal-body">
              {calendarDetailBatch && (
                <>
                  <div className="mb-2">
                    <strong>Subject:</strong> {subjectDisplayName(calendarDetailBatch.Subject) || "-"}
                  </div>
                  <div className="mb-2">
                    <strong>Teacher:</strong> {calendarDetailBatch.Teacher?.teacher_name || "-"}
                  </div>
                  <div className="mb-2">
                    <strong>Section:</strong>{" "}
                    {SECTION_LABEL_BY_KEY[calendarDetailBatch.section] || calendarDetailBatch.section}
                  </div>
                  <div className="mb-2">
                    <strong>Timing:</strong> {calendarDetailBatch.timing}
                  </div>
                  <div className="mb-2">
                    <strong>Number of Days:</strong> {calendarDetailBatch.num_days ?? "-"}
                  </div>
                  <div>
                    <strong>
                      Students ({(calendarDetailBatch.Students || []).length}):
                    </strong>
                    {(calendarDetailBatch.Students || []).length === 0 ? (
                      <div className="text-muted small">No students assigned.</div>
                    ) : (
                      <ul className="mb-0 ps-3">
                        {calendarDetailBatch.Students.map((s) => (
                          <li key={s.id}>
                            {s.applicant_name}
                            {s.comn_enrol_no ? ` (${s.comn_enrol_no})` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">
                Close
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

export default GroupManagement;
