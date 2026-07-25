const { Op } = require("sequelize");
const bcrypt = require("bcryptjs");
const Teacher = require("../models/Teacher");
const Course = require("../models/Course");
require("../models/TeacherCourse");

const STATUSES = ["Active", "Inactive"];

const findDuplicateEmail = async (email, excludeId) => {
  if (!email || !email.trim()) return null;
  const where = {
    email: { [Op.iLike]: email.trim() },
    active: true,
  };
  if (excludeId) {
    where.id = { [Op.ne]: excludeId };
  }
  return Teacher.findOne({ where });
};

const validateTeacherPayload = (body, { isCreate }) => {
  const errors = {};

  if (!body.teacher_name || !body.teacher_name.trim()) {
    errors.teacher_name = "Teacher Name is required.";
  }

  if (
    body.salary !== undefined &&
    body.salary !== null &&
    body.salary !== "" &&
    Number(body.salary) < 0
  ) {
    errors.salary = "Salary cannot be negative.";
  }

  if (body.status && !STATUSES.includes(body.status)) {
    errors.status = "Invalid teacher status.";
  }

  // Login credentials — email + password are how this teacher signs in on
  // the Teacher Login page, so both are required up front on create. On
  // edit, a blank password just means "leave it as is" (checked by callers).
  if (isCreate) {
    if (!body.email || !body.email.trim()) {
      errors.email = "Email is required so this teacher can log in.";
    }
    if (!body.password || body.password.length < 4) {
      errors.password = "Password must be at least 4 characters.";
    }
  } else if (body.password && body.password.length < 4) {
    errors.password = "Password must be at least 4 characters.";
  }

  return errors;
};

const buildPayload = (body) => ({
  teacher_name: body.teacher_name,
  mobile_no: body.mobile_no || null,
  email: body.email || null,
  qualification: body.qualification || null,
  joining_date: body.joining_date || null,
  salary: body.salary === "" || body.salary === undefined ? null : body.salary,
  status: body.status || "Active",
});

const createTeacher = async (req, res) => {
  try {
    const errors = validateTeacherPayload(req.body, { isCreate: true });
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const duplicate = await findDuplicateEmail(req.body.email, null);
    if (duplicate) {
      return res.status(409).json({
        success: false,
        errors: {
          email: "This email is already registered to another teacher.",
        },
      });
    }

    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const teacher = await Teacher.create({
      ...buildPayload(req.body),
      password: hashedPassword,
      is_verified: true,
      admin_id: req.admin?.adminId || null,
    });
    const { password: _password, ...teacherData } = teacher.toJSON();
    teacherData.has_password = !!_password;
    res.status(201).json({
      success: true,
      message: "Teacher added successfully",
      data: teacherData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getAllTeachers = async (req, res) => {
  try {
    const isActive = req.query.active !== "false";
    const teachers = await Teacher.findAll({
      where: { active: isActive, admin_id: req.admin.adminId },
      attributes: { exclude: ["otp", "otp_expires"] },
      include: [{ model: Course, through: { attributes: [] } }],
      order: [["id", "ASC"]],
    });
    // Never ship the bcrypt hash to the client — just whether one is set,
    // so admin can see who still needs a password before they can log in.
    const data = teachers.map((t) => {
      const json = t.toJSON();
      json.has_password = !!json.password;
      delete json.password;
      return json;
    });
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const updateTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const teacher = await Teacher.findOne({
      where: { id, admin_id: req.admin.adminId },
    });
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found",
      });
    }

    const errors = validateTeacherPayload(req.body, { isCreate: false });
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const duplicate = await findDuplicateEmail(req.body.email, teacher.id);
    if (duplicate) {
      return res.status(409).json({
        success: false,
        errors: {
          email: "This email is already registered to another teacher.",
        },
      });
    }

    const updates = buildPayload(req.body);
    if (req.body.password) {
      updates.password = await bcrypt.hash(req.body.password, 10);
    }
    await teacher.update(updates);
    const { password: _password, ...teacherData } = teacher.toJSON();
    teacherData.has_password = !!_password;
    res.status(200).json({
      success: true,
      message: "Teacher updated successfully",
      data: teacherData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const deleteTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const teacher = await Teacher.findOne({
      where: { id, admin_id: req.admin.adminId },
    });
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found",
      });
    }
    await teacher.update({ active: false });
    res.status(200).json({
      success: true,
      message: "Teacher removed successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const restoreTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const teacher = await Teacher.findOne({
      where: { id, admin_id: req.admin.adminId },
    });
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found",
      });
    }
    await teacher.update({ active: true });
    res.status(200).json({
      success: true,
      message: "Teacher restored successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const setTeacherCourses = async (req, res) => {
  try {
    const { id } = req.params;
    const { course_ids } = req.body;
    const teacher = await Teacher.findOne({
      where: { id, admin_id: req.admin.adminId },
    });
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found",
      });
    }
    if (course_ids && course_ids.length > 0) {
      const ownedCount = await Course.count({
        where: { id: course_ids, admin_id: req.admin.adminId },
      });
      if (ownedCount !== course_ids.length) {
        return res.status(404).json({
          success: false,
          message: "One or more courses not found",
        });
      }
    }
    await teacher.setCourses(course_ids || []);
    const updated = await Teacher.findByPk(id, {
      attributes: { exclude: ["password", "otp", "otp_expires"] },
      include: [{ model: Course, through: { attributes: [] } }],
    });
    res.status(200).json({
      success: true,
      message: "Teacher courses updated successfully",
      data: updated,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  createTeacher,
  getAllTeachers,
  updateTeacher,
  deleteTeacher,
  restoreTeacher,
  setTeacherCourses,
};
