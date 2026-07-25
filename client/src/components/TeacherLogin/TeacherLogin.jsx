import { useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api/api";

function TeacherLogin() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
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
      await API.post("/teacher-auth/login", formData);
      navigate("/teacher/dashboard", { replace: true });
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
          <h4 className="mb-3 text-center">Teacher Login</h4>
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
        </div>
      </div>
    </div>
  );
}

export default TeacherLogin;
