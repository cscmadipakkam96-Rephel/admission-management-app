import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Modal } from "bootstrap";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Bar, Line, Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import API from "../../api/api";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

const CATEGORY_OPTIONS = [
  "Utilities",
  "Salary",
  "Rent",
  "Marketing",
  "Office",
  "Maintenance",
  "Travel",
  "Internet",
  "Stationery",
  "Miscellaneous",
];

const CATEGORY_COLORS = {
  Utilities: "#0891b2",
  Salary: "#7c3aed",
  Rent: "#dc2626",
  Marketing: "#ea580c",
  Office: "#16a34a",
  Maintenance: "#ca8a04",
  Travel: "#2563eb",
  Internet: "#0d9488",
  Stationery: "#db2777",
  Miscellaneous: "#6b7280",
};
const DEFAULT_CATEGORY_COLOR = "#94a3b8";
const getCategoryColor = (cat) => CATEGORY_COLORS[cat] || DEFAULT_CATEGORY_COLOR;

const PAYMENT_METHODS = ["Cash", "Card", "Cheque", "UPI", "Bank Transfer","GPay"];

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];



const EXPORT_COLUMNS = [
  { key: "expense_date", label: "Date" },
  { key: "displayTitle", label: "Expense Title" },
  { key: "category", label: "Category" },
  { key: "amount", label: "Amount" },
  { key: "payment_mode", label: "Payment Method" },
  { key: "description", label: "Description" },
  { key: "created_by", label: "Created By" },
];

const todayStr = () => new Date().toISOString().slice(0, 10);

const initialForm = {
  title: "",
  category: "",
  amount: "",
  payment_mode: "Cash",
  expense_date: todayStr(),
  description: "",
  notes: "",
};

const formatCurrency = (n) =>
  `Rs. ${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const startOfWeek = (d) => {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday as start of week
  date.setDate(date.getDate() + diff);
  return date.toISOString().slice(0, 10);
};

function ExpenseTracking() {
  const modalRef = useRef(null);
  const viewModalRef = useRef(null);

  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);

  const [formData, setFormData] = useState(initialForm);
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [viewEntry, setViewEntry] = useState(null);

  const [budget, setBudget] = useState(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [editingBudget, setEditingBudget] = useState(false);

  // --- Filters ---
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [dateMode, setDateMode] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // --- Table ---
  const [sortField, setSortField] = useState("expense_date");
  const [sortOrder, setSortOrder] = useState("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const ROWS_PER_PAGE = 10;

  const fetchExpenses = async () => {
    try {
      const response = await API.get("/expenses?active=true");
      setExpenses(response.data.data);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load expenses.");
    } finally {
      setLoading(false);
    }
  };

  const fetchBudget = async () => {
    try {
      const response = await API.get("/expenses/budget");
      const value = response.data.data.monthly_budget;
      setBudget(value);
      setBudgetInput(value ?? "");
    } catch {
      // Budget is a secondary feature; ignore failures silently.
    }
  };

  useEffect(() => {
    fetchExpenses();
    fetchBudget();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, categoryFilter, paymentFilter, dateMode, customFrom, customTo, sortField, sortOrder]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const forceCleanup = () => {
      document.querySelectorAll(".modal-backdrop").forEach((el) => el.remove());
      document.body.classList.remove("modal-open");
      document.body.style.removeProperty("overflow");
      document.body.style.removeProperty("padding-right");
    };
    const modalEl = modalRef.current;
    const viewModalEl = viewModalRef.current;
    if (modalEl) modalEl.addEventListener("hidden.bs.modal", forceCleanup);
    if (viewModalEl) viewModalEl.addEventListener("hidden.bs.modal", forceCleanup);
    return () => {
      if (modalEl) modalEl.removeEventListener("hidden.bs.modal", forceCleanup);
      if (viewModalEl) viewModalEl.removeEventListener("hidden.bs.modal", forceCleanup);
    };
  }, [loading]);

  const displayTitle = (e) => e.title || e.paid_to || `Expense #${e.id}`;

  // const openAddModal = () => {
  //   setEditingId(null);
  //   setFormData(initialForm);
  //   setFormErrors({});
  //   Modal.getOrCreateInstance(modalRef.current).show();
  // };
  const openAddModal = () => {
    setEditingId(null);
    setFormData({
      ...initialForm,
      expense_date: todayStr(),
    });
    setFormErrors({});
    Modal.getOrCreateInstance(modalRef.current).show();
  };

  const openEditModal = (entry) => {
    setEditingId(entry.id);
    setFormData({
      title: entry.title || entry.paid_to || "",
      category: entry.category || "",
      amount: entry.amount || "",
      payment_mode: entry.payment_mode || "Cash",
      expense_date: entry.expense_date || "",
      description: entry.description || "",
      notes: entry.notes || "",
    });
    setFormErrors({});
    Modal.getOrCreateInstance(modalRef.current).show();
  };

  const openViewModal = (entry) => {
    setViewEntry(entry);
    Modal.getOrCreateInstance(viewModalRef.current).show();
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setFormErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const validate = () => {
    const errors = {};
    if (!formData.title.trim()) errors.title = "Expense title is required.";
    if (!formData.amount) errors.amount = "Amount is required.";
    else if (Number(formData.amount) <= 0)
      errors.amount = "Amount must be greater than 0.";
    if (!formData.expense_date) errors.expense_date = "Date is required.";
    return errors;
  };

  // const handleSubmit = async (e) => {
  //   e.preventDefault();
  //   const errors = validate();
  //   if (Object.keys(errors).length > 0) {
  //     setFormErrors(errors);
  //     return;
  //   }
  //   setFormErrors({});
  //   setSubmitting(true);
  //   try {
  //     const response = editingId
  //       ? await API.put(`/expenses/${editingId}`, formData)
  //       : await API.post("/expenses", formData);
  //     setFormData(initialForm);
  //     setEditingId(null);
  //     Modal.getInstance(modalRef.current)?.hide();
  //     await fetchExpenses();
  //     setToast({
  //       variant: "success",
  //       message: response.data.message || "Expense saved successfully",
  //     });
  //   } catch (err) {
  //     const serverErrors = err.response?.data?.errors;
  //     if (serverErrors) {
  //       setFormErrors(serverErrors);
  //     } else {
  //       setToast({
  //         variant: "danger",
  //         message: err.response?.data?.message || "Failed to save expense.",
  //       });
  //     }
  //   } finally {
  //     setSubmitting(false);
  //   }
  // };
const handleSubmit = async (e) => {
    e.preventDefault();
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});
    setSubmitting(true);
    try {
      const response = editingId
        ? await API.put(`/expenses/${editingId}`, formData)
        : await API.post("/expenses", formData);
      setFormData({
        ...initialForm,
        expense_date: todayStr(),
      });
      setEditingId(null);
      Modal.getInstance(modalRef.current)?.hide();
      await fetchExpenses();
      setToast({
        variant: "success",
        message: response.data.message || "Expense saved successfully",
      });
    } catch (err) {
      const serverErrors = err.response?.data?.errors;
      if (serverErrors) {
        setFormErrors(serverErrors);
      } else {
        setToast({
          variant: "danger",
          message: err.response?.data?.message || "Failed to save expense.",
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const deleteEntry = async (id) => {
    if (!window.confirm("Delete this expense entry? This can be recovered from the database if needed.")) {
      return;
    }
    try {
      const response = await API.delete(`/expenses/${id}`);
      await fetchExpenses();
      setToast({
        variant: "success",
        message: response.data.message || "Expense deleted successfully",
      });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to delete expense.",
      });
    }
  };

  const saveBudget = async () => {
    setBudgetSaving(true);
    try {
      const response = await API.put("/expenses/budget", {
        monthly_budget: budgetInput === "" ? null : Number(budgetInput),
      });
      setBudget(response.data.data.monthly_budget);
      setEditingBudget(false);
      setToast({ variant: "success", message: "Monthly budget updated." });
    } catch (err) {
      setToast({
        variant: "danger",
        message: err.response?.data?.message || "Failed to update budget.",
      });
    } finally {
      setBudgetSaving(false);
    }
  };

  const resetFilters = () => {
    setSearchTerm("");
    setCategoryFilter("");
    setPaymentFilter("");
    setDateMode("all");
    setCustomFrom("");
    setCustomTo("");
  };

  // --- Report cards (fixed periods, computed from full dataset) ---
  const reportStats = useMemo(() => {
    const today = todayStr();
    const now = new Date();
    let total = 0;
    let todayTotal = 0;
    let monthTotal = 0;
    let yearTotal = 0;
    const activeDays = new Set();

    expenses.forEach((e) => {
      const amt = Number(e.amount) || 0;
      total += amt;
      if (e.expense_date) {
        activeDays.add(e.expense_date);
        const d = new Date(`${e.expense_date}T00:00:00`);
        if (e.expense_date === today) todayTotal += amt;
        if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth())
          monthTotal += amt;
        if (d.getFullYear() === now.getFullYear()) yearTotal += amt;
      }
    });

    const avgDaily = activeDays.size > 0 ? total / activeDays.size : 0;

    return { total, todayTotal, monthTotal, yearTotal, avgDaily };
  }, [expenses]);

  const highestThisMonth = useMemo(() => {
    const now = new Date();
    let best = null;
    expenses.forEach((e) => {
      if (!e.expense_date) return;
      const d = new Date(`${e.expense_date}T00:00:00`);
      if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return;
      if (!best || Number(e.amount) > Number(best.amount)) best = e;
    });
    return best;
  }, [expenses]);

  const recentExpenses = useMemo(() => {
    return [...expenses]
      .sort((a, b) => new Date(b.expense_date || 0) - new Date(a.expense_date || 0) || b.id - a.id)
      .slice(0, 5);
  }, [expenses]);

  // --- Filtering (drives table + charts) ---
  const filteredExpenses = useMemo(() => {
    const today = todayStr();
    return expenses.filter((e) => {
      if (searchTerm.trim()) {
        const term = searchTerm.trim().toLowerCase();
        const haystack = `${displayTitle(e)} ${e.description || ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (categoryFilter && e.category !== categoryFilter) return false;
      if (paymentFilter && e.payment_mode !== paymentFilter) return false;

      if (dateMode !== "all" && e.expense_date) {
        if (dateMode === "today" && e.expense_date !== today) return false;
        if (dateMode === "week" && e.expense_date < startOfWeek(today)) return false;
        if (dateMode === "month" && !e.expense_date.startsWith(today.slice(0, 7))) return false;
        if (dateMode === "year" && !e.expense_date.startsWith(today.slice(0, 4))) return false;
        if (dateMode === "custom") {
          if (customFrom && e.expense_date < customFrom) return false;
          if (customTo && e.expense_date > customTo) return false;
        }
      } else if (dateMode !== "all" && !e.expense_date) {
        return false;
      }
      return true;
    });
  }, [expenses, searchTerm, categoryFilter, paymentFilter, dateMode, customFrom, customTo]);

  const sortedExpenses = useMemo(() => {
    return [...filteredExpenses].sort((a, b) => {
      let result;
      if (sortField === "amount") {
        result = (Number(a.amount) || 0) - (Number(b.amount) || 0);
      } else if (sortField === "expense_date") {
        result = new Date(a.expense_date || 0) - new Date(b.expense_date || 0);
      } else if (sortField === "title") {
        result = displayTitle(a).localeCompare(displayTitle(b));
      } else {
        result = (a[sortField] ?? "").toString().localeCompare((b[sortField] ?? "").toString());
      }
      return sortOrder === "asc" ? result : -result;
    });
  }, [filteredExpenses, sortField, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(sortedExpenses.length / ROWS_PER_PAGE));
  const paginatedExpenses = sortedExpenses.slice(
    (currentPage - 1) * ROWS_PER_PAGE,
    currentPage * ROWS_PER_PAGE
  );

  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const sortIcon = (field) => {
    if (sortField !== field) return "bi-arrow-down-up text-muted";
    return sortOrder === "asc" ? "bi-sort-up" : "bi-sort-down";
  };

  // --- Chart data (all derived from filteredExpenses) ---
  const monthlyTrendData = useMemo(() => {
    const now = new Date();
    const buckets = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`, total: 0 });
    }
    const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
    filteredExpenses.forEach((e) => {
      if (!e.expense_date) return;
      const d = new Date(`${e.expense_date}T00:00:00`);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (byKey[key]) byKey[key].total += Number(e.amount) || 0;
    });
    return {
      labels: buckets.map((b) => b.label),
      datasets: [
        {
          label: "Expenses",
          data: buckets.map((b) => b.total),
          borderColor: "#dc2626",
          backgroundColor: "rgba(220, 38, 38, 0.15)",
          tension: 0.3,
          fill: true,
          pointRadius: 3,
        },
      ],
    };
  }, [filteredExpenses]);

  const categoryChartData = useMemo(() => {
    const groups = {};
    filteredExpenses.forEach((e) => {
      const cat = e.category || "Uncategorized";
      groups[cat] = (groups[cat] || 0) + (Number(e.amount) || 0);
    });
    const labels = Object.keys(groups);
    return {
      labels,
      datasets: [
        {
          data: labels.map((l) => groups[l]),
          backgroundColor: labels.map((l) => getCategoryColor(l)),
          borderWidth: 1,
        },
      ],
    };
  }, [filteredExpenses]);

  const paymentMethodChartData = useMemo(() => {
    const groups = {};
    filteredExpenses.forEach((e) => {
      const mode = e.payment_mode || "Unknown";
      groups[mode] = (groups[mode] || 0) + (Number(e.amount) || 0);
    });
    const labels = Object.keys(groups);
    return {
      labels,
      datasets: [
        {
          label: "Amount",
          data: labels.map((l) => groups[l]),
          backgroundColor: "#2563eb",
          borderRadius: 4,
        },
      ],
    };
  }, [filteredExpenses]);

  const last7DaysChartData = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ key, label: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), total: 0 });
    }
    const byKey = Object.fromEntries(days.map((d) => [d.key, d]));
    filteredExpenses.forEach((e) => {
      if (e.expense_date && byKey[e.expense_date]) {
        byKey[e.expense_date].total += Number(e.amount) || 0;
      }
    });
    return {
      labels: days.map((d) => d.label),
      datasets: [
        {
          label: "Expenses",
          data: days.map((d) => d.total),
          backgroundColor: "#16a34a",
          borderRadius: 4,
        },
      ],
    };
  }, [filteredExpenses]);

  const exportRows = () =>
    sortedExpenses.map((e) => ({ ...e, displayTitle: displayTitle(e) }));

  const exportToExcel = () => {
    const data = exportRows().map((row) => {
      const record = {};
      EXPORT_COLUMNS.forEach((col) => {
        record[col.label] = row[col.key] ?? "";
      });
      return record;
    });
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Expenses");
    XLSX.writeFile(workbook, "expense_tracking.xlsx");
  };

  const exportToPDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    const head = [EXPORT_COLUMNS.map((col) => col.label)];
    const body = exportRows().map((row) =>
      EXPORT_COLUMNS.map((col) => (row[col.key] ?? "-").toString())
    );
    doc.setFontSize(14);
    doc.text("Expense Tracking Report", 10, 12);
    autoTable(doc, {
      head,
      body,
      startY: 18,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [220, 38, 38] },
    });
    doc.save("expense_tracking.pdf");
  };

  const budgetSpent = reportStats.monthTotal;
  const budgetRemaining = budget != null ? budget - budgetSpent : null;
  const budgetPercent = budget ? Math.min(100, (budgetSpent / budget) * 100) : 0;
  const budgetBarClass =
    budgetPercent >= 100 ? "bg-danger" : budgetPercent >= 70 ? "bg-warning" : "bg-success";

  if (loading) return <p className="text-center text-muted p-4">Loading...</p>;
  if (error) return <p className="text-center text-danger p-4">{error}</p>;

  return (
    <div className="expense-tracking">
      {toast && (
        <div className="toast-container position-fixed top-0 end-0 p-3" style={{ zIndex: 1080 }}>
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

      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <h3 className="mb-0">
          <i className="bi bi-cash-stack me-2 text-danger"></i>Expense Tracking
        </h3>
        <div className="d-flex gap-2 flex-wrap">
          <Link to="/expense-tracking/inactive" className="btn btn-outline-danger btn-sm">
            <i className="bi bi-x-circle me-1"></i> Inactive Records
          </Link>
          <button type="button" className="btn btn-outline-success btn-sm" onClick={exportToExcel}>
            <i className="bi bi-file-earmark-excel me-1"></i> Export Excel
          </button>
          <button type="button" className="btn btn-outline-danger btn-sm" onClick={exportToPDF}>
            <i className="bi bi-file-earmark-pdf me-1"></i> Export PDF
          </button>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => window.print()}>
            <i className="bi bi-printer me-1"></i> Print
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={openAddModal}>
            <i className="bi bi-plus-lg me-1"></i> Add Expense
          </button>
        </div>
      </div>

      {/* Report cards */}
      <div className="row g-3 mb-4">
        <div className="col-6 col-md-4 col-xl">
          <div className="card shadow-sm h-100 border-0 border-start border-4 border-danger">
            <div className="card-body">
              <div className="text-muted small text-uppercase">Total Expenses</div>
              <div className="fs-5 fw-bold">{formatCurrency(reportStats.total)}</div>
            </div>
          </div>
        </div>
        <div className="col-6 col-md-4 col-xl">
          <div className="card shadow-sm h-100 border-0 border-start border-4 border-primary">
            <div className="card-body">
              <div className="text-muted small text-uppercase">Today's Expenses</div>
              <div className="fs-5 fw-bold">{formatCurrency(reportStats.todayTotal)}</div>
            </div>
          </div>
        </div>
        <div className="col-6 col-md-4 col-xl">
          <div className="card shadow-sm h-100 border-0 border-start border-4 border-warning">
            <div className="card-body">
              <div className="text-muted small text-uppercase">This Month</div>
              <div className="fs-5 fw-bold">{formatCurrency(reportStats.monthTotal)}</div>
            </div>
          </div>
        </div>
        <div className="col-6 col-md-4 col-xl">
          <div className="card shadow-sm h-100 border-0 border-start border-4 border-success">
            <div className="card-body">
              <div className="text-muted small text-uppercase">This Year</div>
              <div className="fs-5 fw-bold">{formatCurrency(reportStats.yearTotal)}</div>
            </div>
          </div>
        </div>
        <div className="col-6 col-md-4 col-xl">
          <div className="card shadow-sm h-100 border-0 border-start border-4 border-info">
            <div className="card-body">
              <div className="text-muted small text-uppercase">Avg Daily Expense</div>
              <div className="fs-5 fw-bold">{formatCurrency(reportStats.avgDaily)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-3 mb-4">
        {/* Monthly Budget card */}
        <div className="col-md-6 col-lg-4">
          <div className="card shadow-sm h-100">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="mb-0">Monthly Budget</h6>
                {!editingBudget && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => setEditingBudget(true)}
                  >
                    <i className="bi bi-pencil"></i>
                  </button>
                )}
              </div>
              {editingBudget ? (
                <div className="d-flex gap-2 mb-2">
                  <input
                    type="number"
                    className="form-control form-control-sm"
                    placeholder="Enter monthly budget"
                    value={budgetInput}
                    onChange={(e) => setBudgetInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={budgetSaving}
                    onClick={saveBudget}
                  >
                    Save
                  </button>
                </div>
              ) : budget == null ? (
                <div className="text-muted small mb-2">No budget set yet.</div>
              ) : (
                <>
                  <div className="d-flex justify-content-between small mb-1">
                    <span>Budget: {formatCurrency(budget)}</span>
                    <span>Spent: {formatCurrency(budgetSpent)}</span>
                  </div>
                  <div className="progress mb-2" style={{ height: "10px" }}>
                    <div
                      className={`progress-bar ${budgetBarClass}`}
                      style={{ width: `${budgetPercent}%` }}
                    ></div>
                  </div>
                  <div className={`small fw-semibold ${budgetRemaining < 0 ? "text-danger" : "text-success"}`}>
                    {budgetRemaining < 0
                      ? `Over budget by ${formatCurrency(Math.abs(budgetRemaining))}`
                      : `Remaining: ${formatCurrency(budgetRemaining)}`}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Highest Expense This Month */}
        <div className="col-md-6 col-lg-4">
          <div className="card shadow-sm h-100">
            <div className="card-body">
              <h6 className="mb-2">Highest Expense This Month</h6>
              {highestThisMonth ? (
                <>
                  <div className="fs-5 fw-bold text-danger">{formatCurrency(highestThisMonth.amount)}</div>
                  <div className="small">{displayTitle(highestThisMonth)}</div>
                  <div className="d-flex align-items-center gap-2 mt-1">
                    <span
                      className="badge"
                      style={{ backgroundColor: getCategoryColor(highestThisMonth.category) }}
                    >
                      {highestThisMonth.category || "Uncategorized"}
                    </span>
                    <span className="text-muted small">{highestThisMonth.expense_date}</span>
                  </div>
                </>
              ) : (
                <div className="text-muted small">No expenses recorded this month.</div>
              )}
            </div>
          </div>
        </div>

        {/* Recent Expenses */}
        <div className="col-lg-4">
          <div className="card shadow-sm h-100">
            <div className="card-body">
              <h6 className="mb-2">Recent Expenses</h6>
              {recentExpenses.length === 0 ? (
                <div className="text-muted small">No expenses yet.</div>
              ) : (
                recentExpenses.map((e) => (
                  <div key={e.id} className="d-flex justify-content-between align-items-center py-1 border-bottom small">
                    <div className="text-truncate" style={{ maxWidth: "60%" }}>
                      {displayTitle(e)}
                      <div className="text-muted" style={{ fontSize: "0.75rem" }}>{e.expense_date}</div>
                    </div>
                    <span className="fw-semibold">{formatCurrency(e.amount)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card shadow-sm mb-4">
        <div className="card-body">
          <h6 className="mb-3">Search &amp; Filters</h6>
          <div className="row g-2 align-items-end">
            <div className="col-md-3">
              <label className="form-label small mb-1">Search Title</label>
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Search by expense title..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="col-md-2">
              <label className="form-label small mb-1">Category</label>
              <select
                className="form-select form-select-sm"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">All Categories</option>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label small mb-1">Payment Method</label>
              <select
                className="form-select form-select-sm"
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
              >
                <option value="">All Methods</option>
                {PAYMENT_METHODS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label small mb-1">Date Range</label>
              <select
                className="form-select form-select-sm"
                value={dateMode}
                onChange={(e) => setDateMode(e.target.value)}
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="year">This Year</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            {dateMode === "custom" && (
              <>
                <div className="col-md-2">
                  <label className="form-label small mb-1">From</label>
                  <input
                    type="date"
                    className="form-control form-control-sm"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label small mb-1">To</label>
                  <input
                    type="date"
                    className="form-control form-control-sm"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="col-md-1">
              <button type="button" className="btn btn-sm btn-outline-secondary w-100" onClick={resetFilters}>
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="row g-3 mb-4">
        <div className="col-lg-6">
          <div className="card shadow-sm h-100">
            <div className="card-body">
              <h6 className="mb-2">Monthly Expense Trend</h6>
              <Line
                data={monthlyTrendData}
                options={{
                  responsive: true,
                  plugins: { legend: { display: false } },
                  scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
                }}
              />
            </div>
          </div>
        </div>
        <div className="col-lg-3 col-md-6">
          <div className="card shadow-sm h-100">
            <div className="card-body">
              <h6 className="mb-2">Expense by Category</h6>
              {categoryChartData.labels.length === 0 ? (
                <div className="text-muted small">No data.</div>
              ) : (
                <Doughnut data={categoryChartData} options={{ responsive: true, plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } } } }} />
              )}
            </div>
          </div>
        </div>
        <div className="col-lg-3 col-md-6">
          <div className="card shadow-sm h-100">
            <div className="card-body">
              <h6 className="mb-2">Expense by Payment Method</h6>
              {paymentMethodChartData.labels.length === 0 ? (
                <div className="text-muted small">No data.</div>
              ) : (
                <Bar
                  data={paymentMethodChartData}
                  options={{
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
                  }}
                />
              )}
            </div>
          </div>
        </div>
        <div className="col-lg-12">
          <div className="card shadow-sm h-100">
            <div className="card-body">
              <h6 className="mb-2">Last 7 Days Expense</h6>
              <Bar
                data={last7DaysChartData}
                options={{
                  responsive: true,
                  plugins: { legend: { display: false } },
                  scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card shadow-sm mb-4">
        <div className="card-body">
          <h5 className="mb-3">
            All Expenses <span className="badge bg-danger ms-1">{sortedExpenses.length}</span>
          </h5>
          <div className="table-responsive">
            <table className="table table-striped table-hover align-middle">
              <thead className="table-light">
                <tr>
                  <th>#</th>
                  <th role="button" onClick={() => handleSort("expense_date")}>
                    Date <i className={`bi ${sortIcon("expense_date")}`}></i>
                  </th>
                  <th role="button" onClick={() => handleSort("title")}>
                    Expense Title <i className={`bi ${sortIcon("title")}`}></i>
                  </th>
                  <th role="button" onClick={() => handleSort("category")}>
                    Category <i className={`bi ${sortIcon("category")}`}></i>
                  </th>
                  <th role="button" onClick={() => handleSort("amount")}>
                    Amount <i className={`bi ${sortIcon("amount")}`}></i>
                  </th>
                  <th>Payment Method</th>
                  <th>Description</th>
                  <th>Created By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedExpenses.length === 0 ? (
                  <tr>
                    <td className="text-center text-muted py-4" colSpan={9}>
                      <i className="bi bi-inbox fs-3 d-block mb-2"></i>
                      No expenses found.
                    </td>
                  </tr>
                ) : (
                  paginatedExpenses.map((entry, index) => (
                    <tr key={entry.id}>
                      <td>{(currentPage - 1) * ROWS_PER_PAGE + index + 1}</td>
                      <td>{entry.expense_date ?? "-"}</td>
                      <td>{displayTitle(entry)}</td>
                      <td>
                        <span className="badge" style={{ backgroundColor: getCategoryColor(entry.category) }}>
                          {entry.category || "Uncategorized"}
                        </span>
                      </td>
                      <td className="fw-semibold">{formatCurrency(entry.amount)}</td>
                      <td>{entry.payment_mode ?? "-"}</td>
                      <td className="text-truncate" style={{ maxWidth: "200px" }}>
                        {entry.description || "-"}
                      </td>
                      <td>{entry.created_by || "-"}</td>
                      <td className="d-flex gap-2">
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => openViewModal(entry)}>
                          <i className="bi bi-eye"></i>
                        </button>
                        <button type="button" className="btn btn-sm btn-outline-warning" onClick={() => openEditModal(entry)}>
                          <i className="bi bi-pencil"></i>
                        </button>
                        <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => deleteEntry(entry.id)}>
                          <i className="bi bi-trash"></i>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="d-flex flex-wrap justify-content-between align-items-center mt-2 gap-2">
            <span className="text-muted small">
              Showing{" "}
              {sortedExpenses.length === 0 ? 0 : (currentPage - 1) * ROWS_PER_PAGE + 1}
              –{Math.min(currentPage * ROWS_PER_PAGE, sortedExpenses.length)} of {sortedExpenses.length} records
            </span>
            <nav>
              <ul className="pagination pagination-sm mb-0">
                <li className={`page-item ${currentPage === 1 ? "disabled" : ""}`}>
                  <button className="page-link" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>
                    « Previous
                  </button>
                </li>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <li key={page} className={`page-item ${currentPage === page ? "active" : ""}`}>
                    <button className="page-link" onClick={() => setCurrentPage(page)}>
                      {page}
                    </button>
                  </li>
                ))}
                <li className={`page-item ${currentPage === totalPages ? "disabled" : ""}`}>
                  <button className="page-link" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>
                    Next »
                  </button>
                </li>
              </ul>
            </nav>
          </div>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <div className="modal fade" id="expenseTrackingModal" tabIndex="-1" ref={modalRef}>
        <div className="modal-dialog">
          <div className="modal-content">
            <form onSubmit={handleSubmit}>
              <div className="modal-header">
                <h5 className="modal-title">{editingId ? "Edit Expense" : "Add Expense"}</h5>
                <button type="button" className="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-md-8">
                    <label className="form-label">Expense Title</label>
                    <input
                      type="text"
                      name="title"
                      className={`form-control ${formErrors.title ? "is-invalid" : ""}`}
                      value={formData.title}
                      onChange={handleChange}
                    />
                    {formErrors.title && <div className="invalid-feedback">{formErrors.title}</div>}
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Category</label>
                    <select
                      name="category"
                      className="form-select"
                      value={formData.category}
                      onChange={handleChange}
                    >
                      <option value="">-- Select --</option>
                      {CATEGORY_OPTIONS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Amount</label>
                    <input
                      type="number"
                      name="amount"
                      className={`form-control ${formErrors.amount ? "is-invalid" : ""}`}
                      value={formData.amount}
                      onChange={handleChange}
                    />
                    {formErrors.amount && <div className="invalid-feedback">{formErrors.amount}</div>}
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Payment Method</label>
                    <select
                      name="payment_mode"
                      className="form-select"
                      value={formData.payment_mode}
                      onChange={handleChange}
                    >
                      {PAYMENT_METHODS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Expense Date</label>
                    <input
                      type="date"
                      name="expense_date"
                      className={`form-control ${formErrors.expense_date ? "is-invalid" : ""}`}
                      value={formData.expense_date}
                      onChange={handleChange}
                    />
                    {formErrors.expense_date && (
                      <div className="invalid-feedback">{formErrors.expense_date}</div>
                    )}
                  </div>
                  <div className="col-12">
                    <label className="form-label">Description</label>
                    <textarea
                      name="description"
                      className="form-control"
                      rows="2"
                      value={formData.description}
                      onChange={handleChange}
                    ></textarea>
                  </div>
                  <div className="col-12">
                    <label className="form-label">Notes (optional)</label>
                    <textarea
                      name="notes"
                      className="form-control"
                      rows="2"
                      value={formData.notes}
                      onChange={handleChange}
                    ></textarea>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">
                  Cancel
                </button>
                <button type="submit" className="btn btn-danger" disabled={submitting}>
                  {submitting ? "Saving..." : editingId ? "Update Expense" : "Save Expense"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* View Modal */}
      <div className="modal fade" id="expenseTrackingViewModal" tabIndex="-1" ref={viewModalRef}>
        <div className="modal-dialog modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Expense Details</h5>
              <button type="button" className="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div className="modal-body">
              {viewEntry && (
                <div className="row g-3">
                  <div className="col-md-6">
                    <div className="text-muted small fw-bold text-uppercase">Expense Title</div>
                    <div>{displayTitle(viewEntry)}</div>
                  </div>
                  <div className="col-md-6">
                    <div className="text-muted small fw-bold text-uppercase">Category</div>
                    <span className="badge" style={{ backgroundColor: getCategoryColor(viewEntry.category) }}>
                      {viewEntry.category || "Uncategorized"}
                    </span>
                  </div>
                  <div className="col-md-6">
                    <div className="text-muted small fw-bold text-uppercase">Amount</div>
                    <div className="fw-bold">{formatCurrency(viewEntry.amount)}</div>
                  </div>
                  <div className="col-md-6">
                    <div className="text-muted small fw-bold text-uppercase">Payment Method</div>
                    <div>{viewEntry.payment_mode || "-"}</div>
                  </div>
                  <div className="col-md-6">
                    <div className="text-muted small fw-bold text-uppercase">Expense Date</div>
                    <div>{viewEntry.expense_date || "-"}</div>
                  </div>
                  <div className="col-md-6">
                    <div className="text-muted small fw-bold text-uppercase">Created By</div>
                    <div>{viewEntry.created_by || "-"}</div>
                  </div>
                  {viewEntry.bill_no && (
                    <div className="col-md-6">
                      <div className="text-muted small fw-bold text-uppercase">Bill Number</div>
                      <div>{viewEntry.bill_no}</div>
                    </div>
                  )}
                  {viewEntry.paid_to && (
                    <div className="col-md-6">
                      <div className="text-muted small fw-bold text-uppercase">Paid To</div>
                      <div>{viewEntry.paid_to}</div>
                    </div>
                  )}
                  <div className="col-12">
                    <div className="text-muted small fw-bold text-uppercase">Description</div>
                    <div>{viewEntry.description || "-"}</div>
                  </div>
                  <div className="col-12">
                    <div className="text-muted small fw-bold text-uppercase">Notes</div>
                    <div>{viewEntry.notes || "-"}</div>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" data-bs-dismiss="modal">
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ExpenseTracking;
