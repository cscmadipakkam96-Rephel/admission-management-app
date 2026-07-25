const { DataTypes } = require("sequelize");
const crypto = require("crypto");
const sequelize = require("../config/db");
const Admin = require("./Admin");

const Teacher = sequelize.define(
  "Teacher",
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
    teacher_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    mobile_no: {
      type: DataTypes.STRING(15),
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    qualification: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    joining_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    salary: {
      type: DataTypes.NUMERIC,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "Active",
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
  },
  {
    tableName: "teachers",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    hooks: {
      beforeCreate: (teacher) => {
        if (!teacher.slug) {
          teacher.slug = crypto.randomBytes(12).toString("hex");
        }
      },
    },
  }
);

module.exports = Teacher;
