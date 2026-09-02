import { Fragment, useEffect, useState } from "react";
import API from "../../api/api";

// Pulls in-time/out-time + completed-day-count tracking from the separate
// Student App (Flutter) project's own API — merged against our own
// admissions so we can also flag who hasn't registered there yet.
function StudentAppAttendance() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await API.get("/batches/student-app-attendance");
        setData(response.data.data);
        setError("");
      } catch (err) {
        setError(err.response?.data?.message || "Failed to load Student App attendance data.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) return <p className="text-center text-muted p-4">Loading...</p>;
  if (error) return <p className="text-center text-danger p-4">{error}</p>;

  const { registered, notRegistered } = data;

  return (
    <>
      <div className="d-flex gap-2 mb-3">
        <span className="badge bg-success fs-6">{registered.length} registered</span>
        <span className="badge bg-secondary fs-6">{notRegistered.length} not registered</span>
      </div>

      <div className="text-uppercase text-muted small fw-bold mb-2">
        Registered — In/Out Time &amp; Day Count
      </div>
      {registered.length === 0 ? (
        <div className="text-muted small mb-4">No students have registered on the Student App yet.</div>
      ) : (
        <div className="table-responsive mb-4">
          <table className="table table-sm table-bordered align-middle">
            <thead className="table-light">
              <tr>
                <th>Student</th>
                <th>Enrol No</th>
                <th>Days Completed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {registered.map((s) => {
                const isOpen = expandedId === s.id;
                const percent = s.total_day_count
                  ? Math.round((s.completed_day_count / s.total_day_count) * 100)
                  : 0;
                return (
                  <Fragment key={s.id}>
                    <tr role="button" onClick={() => setExpandedId(isOpen ? null : s.id)}>
                      <td>{s.applicant_name}</td>
                      <td>{s.comn_enrol_no}</td>
                      <td style={{ minWidth: "160px" }}>
                        <div className="d-flex align-items-center gap-2">
                          <div className="progress flex-grow-1" style={{ height: "8px" }}>
                            <div
                              className={`progress-bar ${percent >= 100 ? "bg-success" : "bg-info"}`}
                              style={{ width: `${percent}%` }}
                            ></div>
                          </div>
                          <span className="small text-nowrap">
                            {s.completed_day_count}/{s.total_day_count}
                          </span>
                        </div>
                      </td>
                      <td>
                        <i className={`bi ${isOpen ? "bi-chevron-up" : "bi-chevron-down"} text-muted`}></i>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={4}>
                          {s.attendance_days.length === 0 ? (
                            <div className="text-muted small">No in/out records yet.</div>
                          ) : (
                            <table className="table table-sm table-bordered mb-0 small">
                              <thead className="table-light">
                                <tr>
                                  <th>Date</th>
                                  <th>In Time</th>
                                  <th>Out Time</th>
                                  <th>Counted</th>
                                </tr>
                              </thead>
                              <tbody>
                                {s.attendance_days.map((d) => (
                                  <tr key={d.date}>
                                    <td>{d.date}</td>
                                    <td>{d.in_time || "-"}</td>
                                    <td>{d.out_time || "-"}</td>
                                    <td>
                                      {d.counted ? (
                                        <span className="badge bg-success">Yes</span>
                                      ) : (
                                        <span className="badge bg-secondary">Partial</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-uppercase text-muted small fw-bold mb-2">Not Registered on Student App</div>
      {notRegistered.length === 0 ? (
        <div className="text-muted small">Every student is registered.</div>
      ) : (
        <div className="table-responsive">
          <table className="table table-sm table-bordered align-middle">
            <thead className="table-light">
              <tr>
                <th>Student</th>
                <th>Enrol No</th>
              </tr>
            </thead>
            <tbody>
              {notRegistered.map((s) => (
                <tr key={s.id}>
                  <td>{s.applicant_name}</td>
                  <td>{s.comn_enrol_no || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default StudentAppAttendance;
