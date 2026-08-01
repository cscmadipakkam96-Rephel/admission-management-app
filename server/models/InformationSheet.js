const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Admin = require("./Admin");

const InformationSheet = sequelize.define(
  "InformationSheet",
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
    applicant_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    father_husband_name: {
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
    email: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    sex: {
      type: DataTypes.STRING(10),
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
    educational_qualification: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    occupation: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    pin_code: {
      type: DataTypes.STRING(6),
      allowNull: true,
    },
    qualification_status: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    qualification_year: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    qualification_subject: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    prior_course_institution: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    prior_course_subject: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    family_income: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    study_reason: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    course_interested: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    preferred_timings: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    plan_to_join: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    heard_source: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    interested_updates: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    sheet_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    enrol_no: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    course: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    date_of_joining: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    counselling_handled_by: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    counselling_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    counselling_time: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: "information_sheets",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  }
);

module.exports = InformationSheet;
