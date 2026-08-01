import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { FiArrowLeft, FiEdit2, FiSave, FiX, FiTrash2 } from "react-icons/fi";
import API from "../../api/api";
import "./Detail.css";

const SELECT_OPTIONS = {
  sex: ["M", "F"],
  religion: ["Hindu", "Christian", "Muslim", "Others"],
  community: ["OC", "BC", "MBC", "ST/SC"],
  occupation: ["Student", "House Wife", "Employed", "Un-employed", "Business"],
  educational_qualification: [
    "10th & Below",
    "12th",
    "Diploma",
    "UG",
    "PG",
    "Other",
  ],
};

const NAME_ONLY_FIELDS = ["applicant_name", "initial", "father_husband_name"];
const NAME_PATTERN = /[^a-zA-Z.'\s]/g;

const DIGIT_ONLY_FIELDS = ["aadhar_no", "telephone_no", "mobile_no"];
const DIGIT_PATTERN = /\D/g;
const DIGIT_LENGTHS = { aadhar_no: 12, telephone_no: 10, mobile_no: 10 };

const calculateAge = (dob) => {
  if (!dob) return "";
  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age.toString() : "";
};

const formatDateTime = (value) => {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const FIELDS = [
  { key: "comn_enrol_no", label: "Enrol No", type: "text" },
  { key: "course_name", label: "Course Name", type: "text" },
  { key: "session", label: "Session", type: "text" },
  { key: "applicant_name", label: "Name", type: "text" },
  { key: "initial", label: "Initial", type: "text" },
  { key: "father_husband_name", label: "Father's / Husband's Name", type: "text" },
  { key: "guardian_occupation", label: "Guardian Occupation", type: "text" },
  { key: "date_of_birth", label: "Date of Birth", type: "date" },
  { key: "age", label: "Age", type: "number" },
  { key: "sex", label: "Sex", type: "select" },
  {
    key: "educational_qualification",
    label: "Qualification",
    type: "select",
  },
  { key: "religion", label: "Religion", type: "select" },
  { key: "community", label: "Community", type: "select" },
  { key: "occupation", label: "Occupation", type: "select" },
  { key: "aadhar_no", label: "Aadhar No", type: "text" },
  { key: "company_name", label: "Company Name", type: "text" },
  { key: "address", label: "Address", type: "text" },
  { key: "telephone_no", label: "Telephone No", type: "text" },
  { key: "mobile_no", label: "Mobile No", type: "text" },
  { key: "email", label: "Email", type: "text" },
  { key: "total_fee", label: "Total Fee (Rs.)", type: "number" },
  {
    key: "first_installment_amount",
    label: "First Installment (Rs.)",
    type: "number",
  },
  { key: "bill_no", label: "Bill No", type: "text" },
  { key: "admission_date", label: "Admission Date", type: "date" },
  { key: "scheme", label: "Scheme", type: "text" },
  { key: "timings", label: "Timings", type: "text" },
];

function Detail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [admission, setAdmission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const response = await API.get(`/admissions/${id}`);
      setAdmission(response.data.data);
      setError("");
    } catch (err) {
      setError(
        err.response?.data?.message || "Failed to load admission details."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const startEdit = () => {
    setEditData({ ...admission });
    setFieldErrors({});
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditData({});
    setFieldErrors({});
  };

  const handleChange = (key, value) => {
    let cleanValue = value;
    let liveError = null;

    if (NAME_ONLY_FIELDS.includes(key)) {
      cleanValue = value.replace(NAME_PATTERN, "");
    } else if (DIGIT_ONLY_FIELDS.includes(key)) {
      cleanValue = value.replace(DIGIT_PATTERN, "");
      const maxLen = DIGIT_LENGTHS[key];
      if (cleanValue.length > maxLen) {
        liveError = `Cannot exceed ${maxLen} digits.`;
      }
    }

    setEditData((prev) => ({
      ...prev,
      [key]: cleanValue,
      // As soon as Date of Birth is picked, auto-fill Age — still editable
      // afterward if it needs a manual correction.
      ...(key === "date_of_birth" ? { age: calculateAge(cleanValue) } : {}),
    }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (liveError) {
        next[key] = liveError;
      } else {
        delete next[key];
      }
      return next;
    });
  };

  const saveEdit = async () => {
    const nextErrors = { ...fieldErrors };
    DIGIT_ONLY_FIELDS.forEach((key) => {
      const value = (editData[key] || "").toString();
      const requiredLength = DIGIT_LENGTHS[key];
      if (value && value.length !== requiredLength) {
        nextErrors[key] = `Must be exactly ${requiredLength} digits.`;
      }
    });

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setSaving(true);
    try {
      const response = await API.put(`/admissions/${id}`, editData);
      setAdmission(response.data.data);
      alert(response.data.message || "Admission updated successfully");
      setEditing(false);
    } catch (err) {
      alert(
        err.response?.data?.message || "Failed to update admission record."
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteAdmission = async () => {
    if (
      !window.confirm("This will move the record to Inactive. Are you sure?")
    ) {
      return;
    }
    try {
      const response = await API.delete(`/admissions/${id}`);
      alert(response.data.message || "Admission marked as inactive");
      navigate("/");
    } catch (err) {
      alert(
        err.response?.data?.message || "Failed to update admission record."
      );
    }
  };

  if (loading) return <p className="detail-status">Loading...</p>;
  if (error) return <p className="detail-status detail-error">{error}</p>;
  if (!admission) return null;

  return (
    <div className="admission-detail">
      <div className="detail-header">
        <Link to="/" className="back-link">
          <FiArrowLeft /> Back to Admission List
        </Link>
        {!editing && (
          <div className="detail-header-actions">
            <button className="btn-edit" onClick={startEdit}>
              <FiEdit2 /> Edit
            </button>
            <button className="btn-delete" onClick={deleteAdmission}>
              <FiTrash2 /> Delete
            </button>
          </div>
        )}
      </div>

      <h2>Admission Details</h2>
      <p className="submitted-on">
        Submitted on {formatDateTime(admission.created_at)}
      </p>

      <div className="detail-grid">
        {FIELDS.map((field) => (
          <div className="detail-field" key={field.key}>
            <label>{field.label}</label>
            {editing ? (
              field.type === "select" ? (
                <select
                  value={editData[field.key] ?? ""}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                >
                  <option value="">Select</option>
                  {SELECT_OPTIONS[field.key].map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type}
                  inputMode={
                    DIGIT_ONLY_FIELDS.includes(field.key)
                      ? "numeric"
                      : undefined
                  }
                  className={fieldErrors[field.key] ? "input-error" : ""}
                  value={editData[field.key] ?? ""}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                />
              )
            ) : (
              <p>{admission[field.key] ?? "-"}</p>
            )}
            {editing && fieldErrors[field.key] && (
              <span className="error-text">{fieldErrors[field.key]}</span>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <div className="detail-actions">
          <button className="btn-save" disabled={saving} onClick={saveEdit}>
            <FiSave /> {saving ? "Saving..." : "Save"}
          </button>
          <button className="btn-cancel" onClick={cancelEdit}>
            <FiX /> Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export default Detail;
