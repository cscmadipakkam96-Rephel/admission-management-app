import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import API from "../../api/api";

const displayTitle = (e) => e.title || e.paid_to || `Expense #${e.id}`;

function InactiveExpenses() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [restoringId, setRestoringId] = useState(null);
  const [toast, setToast] = useState(null);

  const fetchInactive = async () => {
    setLoading(true);
    try {
      const response = await API.get("/expenses?active=false");
      setExpenses(response.data.data);
      setError("");
    } catch (err) {
      setError(
        err.response?.data?.message || "Failed to load inactive expenses."
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

  const restoreExpense = async (id) => {
    setRestoringId(id);
    try {
      const response = await API.put(`/expenses/${id}/restore`);
      setExpenses((prev) => prev.filter((row) => row.id !== id));
      setToast({
        variant: "success",
        message: response.data.message || "Expense restored successfully",
      });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to restore expense.",
      });
    } finally {
      setRestoringId(null);
    }
  };

  const filteredExpenses = expenses.filter((e) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      displayTitle(e).toLowerCase().includes(term) ||
      (e.category || "").toLowerCase().includes(term) ||
      (e.paid_to || "").toLowerCase().includes(term)
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
            <h4 className="mb-0">Inactive Expenses</h4>
            <Link
              to="/expense-tracking"
              className="btn btn-outline-secondary btn-sm"
            >
              <i className="bi bi-arrow-left me-1"></i> Back to Expense
              Tracking
            </Link>
          </div>

          <div className="input-group mb-3" style={{ maxWidth: "350px" }}>
            <span className="input-group-text bg-white">
              <i className="bi bi-search"></i>
            </span>
            <input
              type="text"
              className="form-control"
              placeholder="Search by Title, Category, or Paid To..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="table-responsive">
            <table className="table table-striped table-hover align-middle">
              <thead className="table-primary">
                <tr>
                  <th>#</th>
                  <th>Date</th>
                  <th>Expense Title</th>
                  <th>Category</th>
                  <th>Amount</th>
                  <th>Payment Method</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.length === 0 ? (
                  <tr>
                    <td className="text-center text-muted py-4" colSpan={7}>
                      No inactive expenses found.
                    </td>
                  </tr>
                ) : (
                  filteredExpenses.map((e, index) => (
                    <tr key={e.id}>
                      <td>{index + 1}</td>
                      <td>{e.expense_date || "-"}</td>
                      <td>{displayTitle(e)}</td>
                      <td>{e.category || "-"}</td>
                      <td>Rs. {Number(e.amount || 0).toLocaleString("en-IN")}</td>
                      <td>{e.payment_mode || "-"}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-success"
                          disabled={restoringId === e.id}
                          onClick={() => restoreExpense(e.id)}
                        >
                          <i className="bi bi-arrow-counterclockwise me-1"></i>
                          {restoringId === e.id ? "Restoring..." : "Restore"}
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

export default InactiveExpenses;
