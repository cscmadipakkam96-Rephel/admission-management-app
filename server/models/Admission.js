const { DataTypes } = require("sequelize");
const crypto = require("crypto");
const sequelize = require("../config/db");
const Admin = require("./Admin");

const Admission = sequelize.define(
  "Admission",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    admin_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: Admin,
        key: "adminId",
      },
    },
    comn_enrol_no: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    // "Common Enrol No" (M09 + month-letter + year + running serial) is NOT
    // stored here — it depends on this admission's rank among every other
    // admission by admission_date, which a single-row virtual can't compute.
    // See server/utils/commonEnrolNo.js, applied in admissionController.js.
    course_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    session: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    applicant_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    initial: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    father_husband_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    father_initial: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    guardian_occupation: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    date_of_birth: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    age: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    sex: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
    educational_qualification: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    religion: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    community: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    occupation: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    aadhar_no: {
      type: DataTypes.STRING(20),
      allowNull: true,
      unique: true,
    },
    company_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    mobile_no: {
      type: DataTypes.STRING(25),
      allowNull: true,
    },
    telephone_no: {
      type: DataTypes.STRING(25),
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    total_fee: {
      type: DataTypes.NUMERIC,
      allowNull: true,
    },
    first_installment_amount: {
      type: DataTypes.NUMERIC,
      allowNull: true,
    },
    bill_no: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    admission_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    scheme: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    timings: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    slug: {
      type: DataTypes.STRING(32),
      allowNull: true,
    },
    otp: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
    otp_expires: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    is_verified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    // Tracks whether this student's login was ever pushed to the separate
    // Flutter app's backend — the password itself is never stored here,
    // only this status flag (see AdmissionModal.jsx's Publish/Remove flow).
    published_to_student_app: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    tableName: "admissions",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    hooks: {
      beforeCreate: (admission) => {
        if (!admission.slug) {
          admission.slug = crypto.randomBytes(12).toString("hex");
        }
      },
    },
  }
);

module.exports = Admission;
