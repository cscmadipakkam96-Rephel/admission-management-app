import { useEffect, useState } from "react";
import API from "../../api/api";

const RATING_CATEGORIES = [
  { key: "teaching_quality", label: "Teaching Quality" },
  { key: "doubt_clearing", label: "Doubt Clearing" },
  { key: "staff_behaviour", label: "Staff Behaviour" },
];

const RATING_LABELS = {
  1: "Poor",
  2: "Below Average",
  3: "Good",
  4: "Very Good",
  5: "Excellent",
};

const initialRatings = { teaching_quality: 0, doubt_clearing: 0, staff_behaviour: 0 };

function StarRating({ value, onChange }) {
  return (
    <div>
      <div className="d-flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <i
            key={star}
            role="button"
            className={`bi ${star <= value ? "bi-star-fill text-warning" : "bi-star text-secondary"}`}
            style={{ fontSize: "1.6rem", cursor: "pointer" }}
            onClick={() => onChange(star)}
          ></i>
        ))}
      </div>
      {value > 0 && (
        <div className="text-muted small mt-1">
          {RATING_LABELS[value]} ({value}/5)
        </div>
      )}
    </div>
  );
}

function StudentReview() {
  const [courses, setCourses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [studentName, setStudentName] = useState("");
  const [courseName, setCourseName] = useState("");
  const [facultyName, setFacultyName] = useState("");
  const [ratings, setRatings] = useState(initialRatings);
  const [errors, setErrors] = useState({});
  const [generating, setGenerating] = useState(false);
  const [review, setReview] = useState("");
  const [copied, setCopied] = useState(false);
  const [serverError, setServerError] = useState("");

  useEffect(() => {
    API.get("/review/form-options")
      .then((response) => {
        setCourses(response.data.data.courses);
        setTeachers(response.data.data.teachers);
      })
      .catch(() => {
        // Dropdowns are secondary here; the form still works without them.
      });
  }, []);

  const setRating = (key, value) => {
    setRatings((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    const nextErrors = {};
    if (!studentName.trim()) nextErrors.studentName = "Please enter your name.";
    if (!courseName) nextErrors.courseName = "Please select your course.";
    RATING_CATEGORIES.forEach(({ key }) => {
      if (!ratings[key]) nextErrors[key] = "Required";
    });
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setServerError("");
    setCopied(false);
    setGenerating(true);
    try {
      const response = await API.post("/review/generate", {
        student_name: studentName,
        course_name: courseName,
        faculty_name: facultyName,
        ratings,
      });
      setReview(response.data.data.review);
    } catch (err) {
      setServerError(err.response?.data?.message || "Failed to generate review right now.");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(review);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setServerError("Couldn't copy automatically — please select and copy the text manually.");
    }
  };

  return (
    <div
      className="container-fluid d-flex justify-content-center"
      style={{ minHeight: "100vh", padding: "24px", background: "#f4f6fb" }}
    >
      <div className="card shadow-sm w-100" style={{ maxWidth: "560px", height: "fit-content" }}>
        <div className="card-header bg-primary text-white py-3">
          <h4 className="mb-1">
            <i className="bi bi-star-fill me-2"></i>Student Feedback
          </h4>
          <div className="small opacity-75">Fill in the form and we'll generate your review instantly.</div>
        </div>
        <div className="card-body">
          <form onSubmit={handleGenerate}>
            <div className="mb-3">
              <label className="form-label">
                Student Name <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                className={`form-control ${errors.studentName ? "is-invalid" : ""}`}
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
              />
              {errors.studentName && <div className="invalid-feedback">{errors.studentName}</div>}
            </div>

            <div className="mb-3">
              <label className="form-label">
                Course <span className="text-danger">*</span>
              </label>
              <select
                className={`form-select ${errors.courseName ? "is-invalid" : ""}`}
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
              >
                <option value="">Select your course</option>
                {courses.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {errors.courseName && <div className="invalid-feedback">{errors.courseName}</div>}
            </div>

            <div className="mb-3">
              <label className="form-label">Faculty Name</label>
              <select
                className="form-select"
                value={facultyName}
                onChange={(e) => setFacultyName(e.target.value)}
              >
                <option value="">Select your faculty (optional)</option>
                {teachers.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {RATING_CATEGORIES.map(({ key, label }) => (
              <div className="mb-3" key={key}>
                <label className="form-label d-block">
                  {label} <span className="text-danger">*</span>
                </label>
                <StarRating value={ratings[key]} onChange={(v) => setRating(key, v)} />
                {errors[key] && <div className="text-danger small mt-1">{errors[key]}</div>}
              </div>
            ))}

            {serverError && <div className="alert alert-danger py-2">{serverError}</div>}

            <button type="submit" className="btn btn-primary w-100" disabled={generating}>
              {generating ? "Generating..." : "Generate My Review"}
            </button>
          </form>

          {review && (
            <div className="border border-primary rounded-3 p-3 mt-4">
              <div className="text-primary fw-semibold mb-2">
                <i className="bi bi-stars me-1"></i>Your Generated Review
              </div>
              <p className="mb-3" style={{ whiteSpace: "pre-wrap" }}>
                {review}
              </p>
              <button
                type="button"
                className={`btn w-100 ${copied ? "btn-secondary" : "btn-outline-primary"}`}
                onClick={handleCopy}
              >
                {copied ? (
                  <>
                    <i className="bi bi-check-lg me-1"></i> Copied!
                  </>
                ) : (
                  <>
                    <i className="bi bi-clipboard me-1"></i> Copy
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default StudentReview;
