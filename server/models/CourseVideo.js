const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Admin = require("./Admin");

const CourseVideo = sequelize.define(
  "CourseVideo",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    admin_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: Admin, key: "adminId" },
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    // Never a public URL — resolved through a fresh presigned GET at
    // preview time (server/utils/s3.js), same convention as ClassRecording.
    s3_key: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    // Set once the server-side copy into the Student App's own bucket
    // succeeds — null means the Flutter side doesn't have this video yet
    // (upload to our own bucket can still have succeeded).
    student_app_s3_key: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    file_size_mb: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    content_type: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    is_deleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    tableName: "course_videos",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

// Deliberately no Admin.hasMany(CourseVideo)/CourseVideo.belongsTo(Admin) —
// same reasoning as ClassRecording.js: a plain `references` column still
// gives real FK integrity without risking sequelize.sync({alter:true})
// touching an already-associated model's existing constraints.
module.exports = CourseVideo;
