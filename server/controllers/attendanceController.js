const Attendance = require("../models/Attendance");
const Admission = require("../models/Admission");
const StudentEntryAttendance = require("../models/StudentEntryAttendance");
const Holiday = require("../models/Holiday");
const Batch = require("../models/Batch");
const Subject = require("../models/Subject");
const Teacher = require("../models/Teacher");
const BatchSession = require("../models/BatchSession");
const { parseTimeRange } = require("../utils/timeRange");
const { isSectionActiveToday, SECTION_LABELS } = require("../utils/sections");

const markAttendanceForAdmission = async (admission, slotId = null, batchId = null) => {
  const today = new Date().toISOString().slice(0, 10);

  const existing = await Attendance.findOne({
    where: {
      admission_id: admission.id,
      date: today,
      weekly_schedule_slot_id: slotId,
      batch_id: batchId,
    },
  });
  if (existing) {
    return {
      status: 409,
      body: {
        success: false,
        message: `${admission.applicant_name} is already marked present for this class today`,
      },
    };
  }

  const attendance = await Attendance.create({
    admission_id: admission.id,
    date: today,
    weekly_schedule_slot_id: slotId,
    batch_id: batchId,
  });

  return {
    status: 201,
    body: {
      success: true,
      message: `Attendance marked for ${admission.applicant_name}`,
      data: attendance,
    },
  };
};

const markAttendance = async (req, res) => {
  try {
    const { admission_id } = req.body;
    const admission = await Admission.findByPk(admission_id);
    if (!admission) {
      return res.status(404).json({
        success: false,
        message: "Admission not found",
      });
    }

    const result = await markAttendanceForAdmission(admission);
    res.status(result.status).json(result.body);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const scanAttendance = async (req, res) => {
  try {
    const { slug } = req.params;
    const admission = await Admission.findOne({
      where: { slug, active: true, is_verified: true },
    });
    if (!admission) {
      return res.status(404).json({
        success: false,
        message: "QR not recognized or student not verified",
      });
    }

    const result = await markAttendanceForAdmission(admission);
    res.status(result.status).json(result.body);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getAllAttendance = async (req, res) => {
  try {
    const adminId = req.admin.adminId;

    const attendance = await Attendance.findAll({
      include: [
        {
          model: Admission,
          attributes: ["applicant_name"],
          where: { admin_id: adminId },
        },
      ],
      order: [["date", "DESC"]],
    });

    const entryRecords = await StudentEntryAttendance.findAll({
      where: { admin_id: adminId },
      attributes: ["admission_id", "date"],
    });
    const entrySet = new Set(
      entryRecords.map((e) => `${e.admission_id}_${e.date}`)
    );
    const hasEntry = (admissionId, date) =>
      entrySet.has(`${admissionId}_${date}`);

    const batchIds = [
      ...new Set(attendance.map((a) => a.batch_id).filter(Boolean)),
    ];
    const attBatches = batchIds.length
      ? await Batch.findAll({
          where: { id: batchIds },
          include: [{ model: Subject, attributes: ["subject_name"] }],
        })
      : [];
    const batchById = new Map(attBatches.map((b) => [b.id, b]));

    const presentRecords = attendance.map((a) => {
      const batch = a.batch_id ? batchById.get(a.batch_id) : null;
      const entryFound = hasEntry(a.admission_id, a.date);
      return {
        id: `present-${a.id}`,
        applicant_name: a.Admission?.applicant_name || "-",
        date: a.date,
        marked_at: a.marked_at,
        status: a.status,
        has_entry_attendance: entryFound,
        // Campus entry (fingerprint) attendance isn't set up yet — real
        // status follows the teacher's Present mark alone for now.
        real_status: a.status === "Present" ? "Present" : "Absent",
        group_name: batch?.batch_name || null,
        course_name: batch?.Subject?.subject_name || null,
        timing: batch?.timing || null,
      };
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

    const todayHoliday = await Holiday.findOne({ where: { date: todayStr } });

    const absentRecords = [];

    // "Class ended, no attendance row yet" absentee
    // detection, for Batches whose section runs today.
    if (!todayHoliday) {
      const activeBatches = await Batch.findAll({
        where: { admin_id: adminId, active: true },
        include: [
          { model: Subject, attributes: ["subject_name"] },
          { model: Admission, as: "Students", through: { attributes: [] } },
        ],
      });
      activeBatches
        .filter((b) => isSectionActiveToday(b.section))
        .forEach((batch) => {
          const range = parseTimeRange(batch.timing);
          if (!range || nowMinutes <= range.endMinutes) return;
          (batch.Students || []).forEach((student) => {
            const hasRecord = attendance.some(
              (a) =>
                a.admission_id === student.id &&
                a.date === todayStr &&
                a.batch_id === batch.id
            );
            if (!hasRecord) {
              absentRecords.push({
                id: `absent-batch-${batch.id}-${student.id}`,
                applicant_name: student.applicant_name,
                date: todayStr,
                marked_at: null,
                status: "Absent",
                has_entry_attendance: hasEntry(student.id, todayStr),
                real_status: "Absent",
                group_name: batch.batch_name,
                course_name: batch.Subject?.subject_name || null,
                timing: batch.timing,
              });
            }
          });
        });
    }

    res.status(200).json({
      success: true,
      data: [...absentRecords, ...presentRecords],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getAttendanceByAdmission = async (req, res) => {
  try {
    const { admissionId } = req.params;
    const attendance = await Attendance.findAll({
      where: { admission_id: admissionId },
      order: [["date", "DESC"]],
    });
    res.status(200).json({
      success: true,
      data: attendance,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Concept 2 attendance page — one row per student, per session (batch +
// date) that actually held class. Passing `date` narrows to that single
// day; omitting it returns every session across every date, newest first,
// so the page can show one continuous scrollable history instead of
// picking a date at a time. "Entry" and "Teacher" attendance are two
// independent signals; Final Status only counts a student Present when both
// agree (same cross-check used elsewhere in the app), so a student who was
// marked present by the teacher but never physically entered campus (or vice
// versa) shows up as Absent overall.
const getBatchWiseAttendance = async (req, res) => {
  try {
    const adminId = req.admin.adminId;
    const date = req.query.date || null;
    const { batch_id } = req.query;

    const where = { admin_id: adminId, active: true };
    if (batch_id) where.id = batch_id;

    const batches = await Batch.findAll({
      where,
      include: [
        { model: Subject, attributes: ["subject_name"] },
        { model: Admission, as: "Students", through: { attributes: [] } },
      ],
      order: [["batch_name", "ASC"]],
    });
    const batchById = new Map(batches.map((b) => [b.id, b]));

    const batchIds = batches.map((b) => b.id);
    const sessionWhere = { batch_id: batchIds };
    if (date) sessionWhere.date = date;
    const sessions = batchIds.length
      ? await BatchSession.findAll({ where: sessionWhere, order: [["date", "DESC"]] })
      : [];
    const sessionDates = [...new Set(sessions.map((s) => s.date))];

    // The teacher who actually ran each session — not just the batch's
    // assigned teacher, since a substitute may have covered it that day.
    const sessionTeacherIds = [
      ...new Set(sessions.map((s) => s.teacher_id).filter(Boolean)),
    ];
    const sessionTeachers = sessionTeacherIds.length
      ? await Teacher.findAll({
          where: { id: sessionTeacherIds },
          attributes: ["id", "teacher_name"],
        })
      : [];
    const teacherNameById = new Map(
      sessionTeachers.map((t) => [t.id, t.teacher_name])
    );

    const attendanceWhere = { batch_id: batchIds };
    if (date) attendanceWhere.date = date;
    else if (sessionDates.length) attendanceWhere.date = sessionDates;
    const classAttendance = batchIds.length && sessionDates.length
      ? await Attendance.findAll({ where: attendanceWhere })
      : [];
    const classAttendanceSet = new Set(
      classAttendance.map((a) => `${a.batch_id}-${a.admission_id}-${a.date}`)
    );

    const admissionIds = [
      ...new Set(batches.flatMap((b) => (b.Students || []).map((s) => s.id))),
    ];
    const entryWhere = { admission_id: admissionIds };
    if (date) entryWhere.date = date;
    else if (sessionDates.length) entryWhere.date = sessionDates;
    const entryAttendance = admissionIds.length && sessionDates.length
      ? await StudentEntryAttendance.findAll({ where: entryWhere })
      : [];
    const entrySet = new Set(
      entryAttendance.map((e) => `${e.admission_id}-${e.date}`)
    );

    const rows = [];
    sessions.forEach((session) => {
      const b = batchById.get(session.batch_id);
      if (!b) return;
      (b.Students || []).forEach((student) => {
        const teacherAttendance = classAttendanceSet.has(
          `${b.id}-${student.id}-${session.date}`
        );
        const entryAtt = entrySet.has(`${student.id}-${session.date}`);
        rows.push({
          student_id: student.id,
          student_name: student.applicant_name,
          comn_enrol_no: student.comn_enrol_no,
          batch_id: b.id,
          batch_name: b.batch_name,
          subject_name: b.Subject?.subject_name || null,
          date: session.date,
          topic_covered: session.topic_covered || null,
          teacher_name: teacherNameById.get(session.teacher_id) || null,
          entry_attendance: entryAtt,
          teacher_attendance: teacherAttendance,
          // Campus entry (fingerprint) attendance isn't set up yet, so
          // Final Status follows the teacher's Present mark alone — revisit
          // once entry attendance is actually being captured.
          final_status: teacherAttendance ? "Present" : "Absent",
        });
      });
    });

    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  markAttendance,
  getAllAttendance,
  getAttendanceByAdmission,
  scanAttendance,
  markAttendanceForAdmission,
  getBatchWiseAttendance,
};
