import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import API from "../../api/api";

function InactiveInformationSheets() {
  const [sheets, setSheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [restoringId, setRestoringId] = useState(null);
  const [toast, setToast] = useState(null);

  const fetchInactive = async () => {
    setLoading(true);
    try {
      const response = await API.get("/information-sheets?active=false");
      setSheets(response.data.data);
      setError("");
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Failed to load inactive information sheets."
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

  const restoreSheet = async (id) => {
    setRestoringId(id);
    try {
      const response = await API.put(`/information-sheets/${id}/restore`);
      setSheets((prev) => prev.filter((row) => row.id !== id));
      setToast({
        variant: "success",
        message: response.data.message || "Restored successfully",
      });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to restore.",
      });
    } finally {
      setRestoringId(null);
    }
  };

  const filteredSheets = sheets.filter((s) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      (s.applicant_name || "").toLowerCase().includes(term) ||
      (s.mobile_no || "").toLowerCase().includes(term) ||
      (s.course_interested || "").toLowerCase().includes(term)
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
    <div className="container-fluid" style={{ maxWidth: "1000px" }}>
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
            <h4 className="mb-0">Inactive Information Sheets</h4>
            <Link
              to="/information-sheet"
              className="btn btn-outline-secondary btn-sm"
            >
              <i className="bi bi-arrow-left me-1"></i> Back to Information
              Sheet
            </Link>
          </div>

          <div className="input-group mb-3" style={{ maxWidth: "350px" }}>
            <span className="input-group-text bg-white">
              <i className="bi bi-search"></i>
            </span>
            <input
              type="text"
              className="form-control"
              placeholder="Search by Name, Mobile No, or Course..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="table-responsive">
            <table className="table table-striped table-hover align-middle">
              <thead className="table-primary">
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Mobile</th>
                  <th>Course Interested</th>
                  <th>Plan to Join</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredSheets.length === 0 ? (
                  <tr>
                    <td className="text-center text-muted py-4" colSpan={6}>
                      No inactive information sheets found.
                    </td>
                  </tr>
                ) : (
                  filteredSheets.map((s, index) => (
                    <tr key={s.id}>
                      <td>{index + 1}</td>
                      <td>{s.applicant_name}</td>
                      <td>{s.mobile_no || "-"}</td>
                      <td>{s.course_interested || "-"}</td>
                      <td>{s.plan_to_join || "-"}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-success"
                          disabled={restoringId === s.id}
                          onClick={() => restoreSheet(s.id)}
                        >
                          <i className="bi bi-arrow-counterclockwise me-1"></i>
                          {restoringId === s.id ? "Restoring..." : "Restore"}
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

export default InactiveInformationSheets;
