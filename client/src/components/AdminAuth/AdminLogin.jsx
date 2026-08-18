import { useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import API from "../../api/api";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  `http://${window.location.hostname}:5000/api`;

function AdminLogin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [error, setError] = useState(
    searchParams.get("error") === "google_auth_failed"
      ? "Google sign-in failed. Please try again."
      : ""
  );
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      // Server sets the auth token as an httpOnly cookie on success —
      // nothing for the client to store, just move on.
      await API.post("/admin-auth/login", formData);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || "Failed to log in.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="container-fluid d-flex align-items-center justify-content-center"
      style={{ minHeight: "100vh", padding: "24px" }}
    >
      <div className="card shadow-sm w-100" style={{ maxWidth: "420px" }}>
        <div className="card-body">
          <h4 className="mb-3 text-center">Admin Login</h4>
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label">Email</label>
              <input
                type="email"
                name="email"
                className="form-control"
                value={formData.email}
                onChange={handleChange}
                required
              />
            </div>
            <div className="mb-3">
              <label className="form-label">Password</label>
              <input
                type="password"
                name="password"
                className="form-control"
                value={formData.password}
                onChange={handleChange}
                required
              />
            </div>
            {error && <div className="text-danger small mb-3">{error}</div>}
            <button
              type="submit"
              className="btn btn-primary w-100"
              disabled={submitting}
            >
              {submitting ? "Logging in..." : "Login"}
            </button>
          </form>
          {/* Google sign-in — commented out, not deleted; re-enable if needed later.
          <div className="d-flex align-items-center gap-2 my-3">
            <hr className="flex-grow-1" />
            <span className="text-muted small">OR</span>
            <hr className="flex-grow-1" />
          </div>
          <a
            href={`${API_BASE_URL}/admin-auth/google`}
            className="btn btn-outline-secondary w-100 d-flex align-items-center justify-content-center gap-2"
          >
            <img
              src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
              alt=""
              width="18"
              height="18"
            />
            Sign in with Google
          </a>
          */}
          <p className="text-center text-muted small mt-3 mb-0">
            Don't have an account?{" "}
            <Link to="/register">Register as Admin</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default AdminLogin;
