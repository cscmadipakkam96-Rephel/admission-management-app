import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import API from "../../api/api";

function InactiveTeachers() {
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [restoringId, setRestoringId] = useState(null);
  const [toast, setToast] = useState(null);

  const fetchInactive = async () => {
    setLoading(true);
    try {
      const response = await API.get("/teachers?active=false");
      setTeachers(response.data.data);
      setError("");
    } catch (err) {
      setError(
        err.response?.data?.message || "Failed to load inactive teachers."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInactive();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const restoreTeacher = async (id) => {
    setRestoringId(id);
    try {
      const response = await API.put(`/teachers/${id}/restore`);
      setTeachers((prev) => prev.filter((row) => row.id !== id));
      setToast({
        variant: "success",
        message: response.data.message || "Teacher restored successfully",
      });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to restore teacher.",
      });
    } finally {
      setRestoringId(null);
    }
  };

  const filteredTeachers = teachers.filter((t) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      (t.teacher_name || "").toLowerCase().includes(term) ||
      (t.mobile_no || "").toLowerCase().includes(term) ||
      (t.email || "").toLowerCase().includes(term)
    );
  });

  if (loading)
    return (
      <div className="text-center p-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  if (error) return <p className="text-center text-danger p-4">{error}</p>;

  return (
    <div className="container-fluid" style={{ maxWidth: "1100px" }}>
      {toast && (
        <div
          className="toast-container position-fixed top-0 end-0 p-3"
          style={{ zIndex: 1080 }}
        >
          <div className={`toast show text-white bg-${toast.variant}`}>
            <div className="d-flex">
              <div className="toast-body">{toast.message}</div>
              <button
                type="button"
                className="btn-close btn-close-white me-2 m-auto"
                onClick={() => setToast(null)}
              ></button>
            </div>
          </div>
        </div>
      )}

      <div className="card shadow-sm">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
            <h4 className="mb-0">Inactive Teachers</h4>
            <Link to="/teachers" className="btn btn-outline-secondary btn-sm">
              <i className="bi bi-arrow-left me-1"></i> Back to Teacher
              Management
            </Link>
          </div>

          <div className="input-group mb-3" style={{ maxWidth: "350px" }}>
            <span className="input-group-text bg-white">
              <i className="bi bi-search"></i>
            </span>
            <input
              type="text"
              className="form-control"
              placeholder="Search by Name, Mobile, or Email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="table-responsive">
            <table className="table table-striped table-hover align-middle">
              <thead className="table-primary">
                <tr>
                  <th>#</th>
                  <th>Teacher Name</th>
                  <th>Mobile No</th>
                  <th>Email</th>
                  <th>Qualification</th>
                  <th>Joining Date</th>
                  <th>Salary</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredTeachers.length === 0 ? (
                  <tr>
                    <td className="text-center text-muted py-4" colSpan={8}>
                      No inactive teachers found.
                    </td>
                  </tr>
                ) : (
                  filteredTeachers.map((t, index) => (
                    <tr key={t.id}>
                      <td>{index + 1}</td>
                      <td>{t.teacher_name}</td>
                      <td>{t.mobile_no || "-"}</td>
                      <td>{t.email || "-"}</td>
                      <td>{t.qualification || "-"}</td>
                      <td>{t.joining_date || "-"}</td>
                      <td>{t.salary || "-"}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-success"
                          disabled={restoringId === t.id}
                          onClick={() => restoreTeacher(t.id)}
                        >
                          <i className="bi bi-arrow-counterclockwise me-1"></i>
                          {restoringId === t.id ? "Restoring..." : "Restore"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default InactiveTeachers;
