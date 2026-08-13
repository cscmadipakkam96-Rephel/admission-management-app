const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
// deploy-trigger check

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { Op } = require("sequelize");
require("dotenv").config();
const sequelize = require("./config/db");
const { splitNameInitial } = require("./utils/splitNameInitial");
const Admission = require("./models/Admission");
const FeePayment = require("./models/FeePayment");
const InformationSheet = require("./models/InformationSheet");
const Course = require("./models/Course");
const FeeEntry = require("./models/FeeEntry");
const Attendance = require("./models/Attendance");
const Subject = require("./models/Subject");
const CourseSubject = require("./models/CourseSubject");
const Teacher = require("./models/Teacher");
const TeacherCourse = require("./models/TeacherCourse");
const Holiday = require("./models/Holiday");
const TeacherAvailability = require("./models/TeacherAvailability");
const StudentEntryAttendance = require("./models/StudentEntryAttendance");
const TeacherEntryAttendance = require("./models/TeacherEntryAttendance");
const Expense = require("./models/Expense");
const Batch = require("./models/Batch");
const BatchStudent = require("./models/BatchStudent");
const BatchSession = require("./models/BatchSession");
const BatchSubstitution = require("./models/BatchSubstitution");
const FollowUp = require("./models/FollowUp");

const Admin = require("./models/Admin");


const admissionRoutes = require("./routes/admissionRoutes");
const feePaymentRoutes = require("./routes/feePaymentRoutes");
const informationSheetRoutes = require("./routes/informationSheetRoutes");
const courseRoutes = require("./routes/courseRoutes");
const feeEntryRoutes = require("./routes/feeEntryRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const attendanceAuthRoutes = require("./routes/attendanceAuthRoutes");
const subjectRoutes = require("./routes/subjectRoutes");
const teacherRoutes = require("./routes/teacherRoutes");
const teacherAuthRoutes = require("./routes/teacherAuthRoutes");
const holidayRoutes = require("./routes/holidayRoutes");
const teacherAvailabilityRoutes = require("./routes/teacherAvailabilityRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const entryAttendanceRoutes = require("./routes/entryAttendanceRoutes");
const batchRoutes = require("./routes/batchRoutes");
const followUpRoutes = require("./routes/followUpRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const adminAuthRoutes = require("./routes/adminAuthRoutes");
const requireAdminAuth = require("./middleware/adminAuth");

const app = express();
const PORT = process.env.PORT || 5000;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get("/", (req, res) => {
  res.send("Server is running");
});

// Public — no admin login required (self-service links for teachers/students,
// admin registration/login itself, and holidays which those public pages read)
app.use("/api/admin-auth", adminAuthRoutes);
app.use("/api/attendance-auth", attendanceAuthRoutes);
app.use("/api/teacher-auth", teacherAuthRoutes);
app.use("/api/holidays", holidayRoutes);
app.use("/api/review", reviewRoutes);

// Everything below requires a logged-in admin
app.use("/api/admissions", requireAdminAuth, admissionRoutes);
app.use("/api/fee-payments", requireAdminAuth, feePaymentRoutes);
app.use("/api/information-sheets", requireAdminAuth, informationSheetRoutes);
app.use("/api/courses", requireAdminAuth, courseRoutes);
app.use("/api/fee-entries", requireAdminAuth, feeEntryRoutes);
app.use("/api/attendance", requireAdminAuth, attendanceRoutes);
app.use("/api/subjects", requireAdminAuth, subjectRoutes);
app.use("/api/teachers", requireAdminAuth, teacherRoutes);
app.use("/api/teacher-availability", requireAdminAuth, teacherAvailabilityRoutes);
app.use("/api/expenses", requireAdminAuth, expenseRoutes);
app.use("/api/entry-attendance", requireAdminAuth, entryAttendanceRoutes);
app.use("/api/batches", requireAdminAuth, batchRoutes);
app.use("/api/follow-ups", requireAdminAuth, followUpRoutes);

// One-time, idempotent: splits any admission's father_husband_name that
// still bundles a dot-separated initial (e.g. "R.Yasir") into
// father_husband_name + father_initial, same rule as the existing
// applicant_name/initial split (server/utils/splitNameInitial.js). Only
// touches rows where father_initial hasn't been set yet, so this is a
// no-op on every boot after the first successful run — safe to leave
// running permanently rather than requiring a manual one-off script.
const migrateFatherInitial = async () => {
  const candidates = await Admission.findAll({
    where: {
      father_husband_name: { [Op.like]: "%.%" },
      [Op.or]: [{ father_initial: null }, { father_initial: "" }],
    },
  });
  let migrated = 0;
  for (const admission of candidates) {
    const result = splitNameInitial(admission.father_husband_name);
    if (!result) continue;
    await admission.update({
      father_husband_name: result.name,
      father_initial: result.initial,
    });
    migrated++;
  }
  if (migrated > 0) {
    console.log(`Migrated father_initial for ${migrated} admission record(s).`);
  }
};

// One-time, idempotent: same idea as migrateFatherInitial above, but for
// Information Sheet's applicant_name/initial and father_husband_name/
// father_initial pairs, neither of which was ever backfilled for existing
// rows. Fetches every row missing either initial (not filtered by "."
// in SQL, since splitNameInitial also handles the dot-less "Name A" case)
// and only writes back rows where a split was actually found.
const migrateInformationSheetNames = async () => {
  const candidates = await InformationSheet.findAll({
    where: {
      [Op.or]: [
        { initial: null },
        { initial: "" },
        { father_initial: null },
        { father_initial: "" },
      ],
    },
  });
  let migrated = 0;
  for (const sheet of candidates) {
    const updates = {};
    if (!sheet.initial && sheet.applicant_name) {
      const result = splitNameInitial(sheet.applicant_name);
      if (result) {
        updates.applicant_name = result.name;
        updates.initial = result.initial;
      }
    }
    if (!sheet.father_initial && sheet.father_husband_name) {
      const result = splitNameInitial(sheet.father_husband_name);
      if (result) {
        updates.father_husband_name = result.name;
        updates.father_initial = result.initial;
      }
    }
    if (Object.keys(updates).length > 0) {
      await sheet.update(updates);
      migrated++;
    }
  }
  if (migrated > 0) {
    console.log(`Migrated name/initial split for ${migrated} information sheet record(s).`);
  }
};

sequelize.sync({ alter: true }).then(async () => {
  console.log("Admissions and FeePayments tables synced");
  try {
    await migrateFatherInitial();
  } catch (err) {
    console.error("father_initial migration failed:", err.message);
  }
  try {
    await migrateInformationSheetNames();
  } catch (err) {
    console.error("information sheet name migration failed:", err.message);
  }
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});