import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FiArrowLeft, FiRotateCcw } from "react-icons/fi";
import API from "../../api/api";
import "./InactiveList.css";

const COLUMNS = [
  { key: "comn_enrol_no", label: "Enrol No" },
  { key: "course_name", label: "Course" },
  { key: "session", label: "Session" },
  { key: "applicant_name", label: "Name" },
  { key: "initial", label: "Initial" },
  { key: "father_husband_name", label: "Father/Husband" },
  { key: "guardian_occupation", label: "Guardian Occupation" },
  { key: "date_of_birth", label: "DOB" },
  { key: "age", label: "Age" },
  { key: "sex", label: "Sex" },
  { key: "educational_qualification", label: "Qualification" },
  { key: "religion", label: "Religion" },
  { key: "community", label: "Community" },
  { key: "occupation", label: "Occupation" },
  { key: "aadhar_no", label: "Aadhar No" },
  { key: "company_name", label: "Company" },
  { key: "address", label: "Address" },
  { key: "mobile_no", label: "Mobile" },
  { key: "email", label: "Email" },
  { key: "total_fee", label: "Total Fee" },
  { key: "first_installment_amount", label: "1st Installment" },
  { key: "bill_no", label: "Bill No" },
  { key: "scheme", label: "Scheme" },
  { key: "timings", label: "Timings" },
];

function InactiveList() {
  const [admissions, setAdmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restoringId, setRestoringId] = useState(null);

  const fetchInactive = async () => {
    setLoading(true);
    try {
      const response = await API.get("/admissions?active=false");
      setAdmissions(response.data.data);
      setError("");
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Failed to load inactive admission records."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInactive();
  }, []);

  const restoreAdmission = async (id) => {
    if (
      !window.confirm("Restore this record back to the Active list?")
    ) {
      return;
    }
    setRestoringId(id);
    try {
      const response = await API.put(`/admissions/${id}`, { active: true });
      setAdmissions((prev) => prev.filter((row) => row.id !== id));
      alert(response.data.message || "Admission restored successfully");
    } catch (err) {
      alert(
        err.response?.data?.message || "Failed to restore admission record."
      );
    } finally {
      setRestoringId(null);
    }
  };

  if (loading) return <p className="list-status">Loading...</p>;
  if (error) return <p className="list-status list-error">{error}</p>;

  return (
    <div className="admission-list inactive-list">
      <div className="list-header">
        <Link to="/" className="back-link">
          <FiArrowLeft /> Back to Admission List
        </Link>
        <h2>Inactive Records</h2>
      </div>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              {COLUMNS.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {admissions.length === 0 ? (
              <tr>
                <td className="list-status" colSpan={COLUMNS.length + 2}>
                  No inactive records found.
                </td>
              </tr>
            ) : (
              admissions.map((row, index) => (
                <tr key={row.id}>
                  <td>{index + 1}</td>
                  {COLUMNS.map((col) => (
                    <td key={col.key}>{row[col.key] ?? "-"}</td>
                  ))}
                  <td className="actions-cell">
                    <button
                      className="btn-restore"
                      disabled={restoringId === row.id}
                      onClick={() => restoreAdmission(row.id)}
                    >
                      <FiRotateCcw />{" "}
                      {restoringId === row.id ? "Restoring..." : "Restore"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default InactiveList;
