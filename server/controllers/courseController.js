const { Op } = require("sequelize");
const Course = require("../models/Course");
const Subject = require("../models/Subject");
require("../models/CourseSubject");

const LEVELS = ["Beginner", "Intermediate", "Advanced"];
const STATUSES = ["Active", "Upcoming", "Completed"];

const validateCoursePayload = (body) => {
  const errors = {};

  if (!body.course_name || !body.course_name.trim()) {
    errors.course_name = "Course Name is required.";
  }

  if (
    body.standard_fee !== undefined &&
    body.standard_fee !== null &&
    body.standard_fee !== "" &&
    Number(body.standard_fee) < 0
  ) {
    errors.standard_fee = "Fee cannot be negative.";
  }

  if (
    body.total_seats !== undefined &&
    body.total_seats !== null &&
    body.total_seats !== "" &&
    Number(body.total_seats) <= 0
  ) {
    errors.total_seats = "Seats must be greater than zero.";
  }

  if (body.level && !LEVELS.includes(body.level)) {
    errors.level = "Invalid course level.";
  }

  if (body.status && !STATUSES.includes(body.status)) {
    errors.status = "Invalid course status.";
  }

  return errors;
};

const buildPayload = (body) => ({
  course_code: body.course_code || null,
  course_name: body.course_name,
  category: body.category || null,
  description: body.description || null,
  level: body.level || null,
  project: body.project || null,
  status: body.status || "Active",
  duration: body.duration || null,
  standard_fee:
    body.standard_fee === "" || body.standard_fee === undefined
      ? null
      : body.standard_fee,
  timings: body.timings || null,
  total_seats:
    body.total_seats === "" || body.total_seats === undefined
      ? null
      : body.total_seats,
});

const createCourse = async (req, res) => {
  try {
    const errors = validateCoursePayload(req.body);
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    if (req.body.course_code) {
      const existing = await Course.findOne({
        where: {
          course_code: req.body.course_code,
          admin_id: req.admin.adminId,
        },
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          field: "course_code",
          message: "This Course Code is already in use.",
        });
      }
    }

    const course = await Course.create({
      ...buildPayload(req.body),
      admin_id: req.admin?.adminId || null,
    });
    res.status(201).json({
      success: true,
      message: "Course added successfully",
      data: course,
    });
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({
        success: false,
        field: "course_code",
        message: "This Course Code is already in use.",
      });
    }
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Course codes are plain sequential numbers ("101", "102", ...). Looks at
// every course for this admin — active AND inactive — so a re-used code
// never collides with one a soft-deleted course still holds.
const getNextCourseCode = async (req, res) => {
  try {
    const courses = await Course.findAll({
      where: { admin_id: req.admin.adminId },
      attributes: ["course_code"],
    });
    const numericCodes = courses
      .map((c) => parseInt(c.course_code, 10))
      .filter((n) => Number.isFinite(n));
    const nextCode = numericCodes.length ? Math.max(...numericCodes) + 1 : 101;
    res.status(200).json({
      success: true,
      data: { next_code: String(nextCode) },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getAllCourses = async (req, res) => {
  try {
    const isActive = req.query.active !== "false";
    const courses = await Course.findAll({
      where: { active: isActive, admin_id: req.admin.adminId },
      include: [{ model: Subject, through: { attributes: [] } }],
      order: [["id", "ASC"]],
    });
    res.status(200).json({
      success: true,
      data: courses,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const setCourseSubjects = async (req, res) => {
  try {
    const { id } = req.params;
    const { subject_ids } = req.body;
    const course = await Course.findOne({
      where: { id, admin_id: req.admin.adminId },
    });
    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }
    if (subject_ids && subject_ids.length > 0) {
      const ownedCount = await Subject.count({
        where: { id: subject_ids, admin_id: req.admin.adminId },
      });
      if (ownedCount !== subject_ids.length) {
        return res.status(404).json({
          success: false,
          message: "One or more subjects not found",
        });
      }
    }
    await course.setSubjects(subject_ids || []);
    const updated = await Course.findByPk(id, {
      include: [{ model: Subject, through: { attributes: [] } }],
    });
    res.status(200).json({
      success: true,
      message: "Course subjects updated successfully",
      data: updated,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const updateCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const course = await Course.findOne({
      where: { id, admin_id: req.admin.adminId },
    });
    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    const errors = validateCoursePayload(req.body);
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    if (req.body.course_code) {
      const existing = await Course.findOne({
        where: {
          course_code: req.body.course_code,
          admin_id: req.admin.adminId,
          id: { [Op.ne]: id },
        },
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          field: "course_code",
          message: "This Course Code is already in use.",
        });
      }
    }

    await course.update(buildPayload(req.body));
    res.status(200).json({
      success: true,
      message: "Course updated successfully",
      data: course,
    });
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({
        success: false,
        field: "course_code",
        message: "This Course Code is already in use.",
      });
    }
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const deleteCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const course = await Course.findOne({
      where: { id, admin_id: req.admin.adminId },
    });
    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }
    await course.update({ active: false });
    res.status(200).json({
      success: true,
      message: "Course marked as inactive successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const restoreCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const course = await Course.findOne({
      where: { id, admin_id: req.admin.adminId },
    });
    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }
    await course.update({ active: true });
    res.status(200).json({
      success: true,
      message: "Course restored successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  createCourse,
  getNextCourseCode,
  getAllCourses,
  updateCourse,
  deleteCourse,
  restoreCourse,
  setCourseSubjects,
};
