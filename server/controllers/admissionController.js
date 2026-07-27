const Admission = require("../models/Admission");
const FeePayment = require("../models/FeePayment");
const { calculateAge } = require("../utils/age");
const { buildCommonEnrolNoMap } = require("../utils/commonEnrolNo");

// Common Enrol No ranks an admission among every active admission for this
// admin — always computed against the full active roster, regardless of
// what subset the caller is displaying, so the number stays stable no
// matter which page/filter you're looking at it from.
const attachCommonEnrolNo = async (adminId, admissions) => {
  const roster = await Admission.findAll({
    where: { active: true, admin_id: adminId },
    attributes: ["id", "admission_date", "created_at", "comn_enrol_no"],
  });
  const enrolMap = buildCommonEnrolNoMap(roster);
  return admissions.map((a) => {
    const json = a.toJSON();
    json.common_enrol_no = enrolMap.get(a.id) || null;
    return json;
  });
};

const NULLABLE_IF_EMPTY_FIELDS = [
  "aadhar_no",
  "age",
  "date_of_birth",
  "admission_date",
  "total_fee",
  "first_installment_amount",
];

const sanitizePayload = (body) => {
  const payload = { ...body };
  NULLABLE_IF_EMPTY_FIELDS.forEach((field) => {
    if (payload[field] === "") {
      payload[field] = null;
    }
  });
  // Age wasn't typed but Date of Birth was given — compute and store it so
  // every record has an age, regardless of whether the form field was filled.
  if ((payload.age === null || payload.age === undefined) && payload.date_of_birth) {
    payload.age = calculateAge(payload.date_of_birth);
  }
  return payload;
};

const createAdmission = async (req, res) => {
  try {
    const payload = sanitizePayload(req.body);

    if (payload.aadhar_no) {
      const existing = await Admission.findOne({
        where: { aadhar_no: payload.aadhar_no, admin_id: req.admin.adminId },
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          field: "aadhar_no",
          message: "This Aadhar number is already registered.",
        });
      }
    }

    const admission = await Admission.create({
      ...payload,
      admin_id: req.admin?.adminId || null,
    });
    const [data] = await attachCommonEnrolNo(req.admin.adminId, [admission]);
    res.status(201).json({
      success: true,
      message: "Admission submitted successfully",
      data,
    });
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({
        success: false,
        field: "aadhar_no",
        message: "This Aadhar number is already registered.",
      });
    }
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getAllAdmissions = async (req, res) => {
  try {
    const isActive = req.query.active !== "false";
    const admissions = await Admission.findAll({
      where: { active: isActive, admin_id: req.admin.adminId },
      include: [{ model: FeePayment }],
      order: [["id", "ASC"]],
    });
    const data = await attachCommonEnrolNo(req.admin.adminId, admissions);
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

const getAdmissionById = async (req, res) => {
  try {
    const { id } = req.params;
    const admission = await Admission.findOne({
      where: { id, admin_id: req.admin.adminId },
      include: [{ model: FeePayment }],
    });
    if (!admission) {
      return res.status(404).json({
        success: false,
        message: "Admission not found",
      });
    }
    const [data] = await attachCommonEnrolNo(req.admin.adminId, [admission]);
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

const updateAdmission = async (req, res) => {
  try {
    const { id } = req.params;
    const admission = await Admission.findOne({
      where: { id, admin_id: req.admin.adminId },
    });
    if (!admission) {
      return res.status(404).json({
        success: false,
        message: "Admission not found",
      });
    }
    const payload = sanitizePayload(req.body);
    await admission.update(payload);
    const [data] = await attachCommonEnrolNo(req.admin.adminId, [admission]);
    res.status(200).json({
      success: true,
      message: "Admission updated successfully",
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const deleteAdmission = async (req, res) => {
  try {
    const { id } = req.params;
    const admission = await Admission.findOne({
      where: { id, admin_id: req.admin.adminId },
    });
    if (!admission) {
      return res.status(404).json({
        success: false,
        message: "Admission not found",
      });
    }
    await admission.update({ active: false });
    res.status(200).json({
      success: true,
      message: "Admission marked as inactive successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getAdmissionBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const admission = await Admission.findOne({
      where: { slug, active: true, is_verified: true },
      attributes: ["applicant_name", "slug"],
    });
    if (!admission) {
      return res.status(404).json({
        success: false,
        message: "Not found or not verified yet",
      });
    }
    res.status(200).json({
      success: true,
      data: admission,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  createAdmission,
  getAllAdmissions,
  getAdmissionById,
  updateAdmission,
  deleteAdmission,
  getAdmissionBySlug,
};
