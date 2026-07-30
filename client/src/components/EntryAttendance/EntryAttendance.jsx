import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import API from "../../api/api";

const toDateStr = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const todayStr = toDateStr(new Date());
const yesterdayStr = toDateStr(
  new Date(new Date().setDate(new Date().getDate() - 1))
);

// "HH:MM" (24h, local time) for comparing against an entry's marked_at time.
const toTimeStr = (isoString) => {
  const d = new Date(isoString);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
};

function EntryAttendance() {
  const [personType, setPersonType] = useState("student");
  // "" means All Dates — one merged, scrollable, date-ordered history
  // instead of picking a single day.
  const [selectedDate, setSelectedDate] = useState("");
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");

  useEffect(() => {
    const fetchEntries = async () => {
      setLoading(true);
      try {
        const endpoint =
          personType === "student"
            ? "/entry-attendance/students"
            : "/entry-attendance/teachers";
        const response = await API.get(endpoint, {
          params: { date: selectedDate || undefined },
        });
        setEntries(response.data.data);
        setError("");
      } catch (err) {
        setError(
          err.response?.data?.message || "Failed to load entry attendance."
        );
      } finally {
        setLoading(false);
      }
    };
    fetchEntries();
  }, [personType, selectedDate]);

  const filteredEntries = useMemo(() => {
    const term = nameFilter.trim().toLowerCase();
    return entries.filter((e) => {
      if (term && !(e.name || "").toLowerCase().includes(term)) return false;
      if (!e.marked_at) return !fromTime && !toTime;
      const entryTime = toTimeStr(e.marked_at);
      if (fromTime && entryTime < fromTime) return false;
      if (toTime && entryTime > toTime) return false;
      return true;
    });
  }, [entries, nameFilter, fromTime, toTime]);

  const clearFilters = () => {
    setNameFilter("");
    setFromTime("");
    setToTime("");
  };
  const hasActiveFilters = nameFilter || fromTime || toTime;

  return (
    <div className="container-fluid" style={{ maxWidth: "1000px" }}>
      <div className="card shadow-sm">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
            <h4 className="mb-0">Entry Attendance</h4>
            <Link to="/entry-attendance/scan" className="btn btn-primary btn-sm">
              Scan Entry Attendance
            </Link>
          </div>

          <div className="btn-group mb-3" role="group">
            <button
              type="button"
              className={`btn btn-sm ${personType === "student" ? "btn-primary" : "btn-outline-primary"}`}
              onClick={() => setPersonType("student")}
            >
              Student
            </button>
            <button
              type="button"
              className={`btn btn-sm ${personType === "teacher" ? "btn-primary" : "btn-outline-primary"}`}
              onClick={() => setPersonType("teacher")}
            >
              Teacher
            </button>
          </div>

          <div className="row g-2 mb-3 align-items-end">
            <div className="col-auto">
              <button
                type="button"
                className={`btn btn-sm ${selectedDate === "" ? "btn-primary" : "btn-outline-primary"}`}
                onClick={() => setSelectedDate("")}
              >
                All Dates
              </button>
            </div>
            <div className="col-auto">
              <button
                type="button"
                className={`btn btn-sm ${selectedDate === todayStr ? "btn-primary" : "btn-outline-primary"}`}
                onClick={() => setSelectedDate(todayStr)}
              >
                Today
              </button>
            </div>
            <div className="col-auto">
              <button
                type="button"
                className={`btn btn-sm ${selectedDate === yesterdayStr ? "btn-primary" : "btn-outline-primary"}`}
                onClick={() => setSelectedDate(yesterdayStr)}
              >
                Yesterday
              </button>
            </div>
            <div className="col-auto">
              <label className="form-label small mb-1">Date</label>
              <input
                type="date"
                className="form-control form-control-sm"
                value={selectedDate}
                max={todayStr}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
            </div>
            <div className="col-auto">
              <label className="form-label small mb-1">Name</label>
              <div className="input-group input-group-sm">
                <span className="input-group-text bg-white">
                  <i className="bi bi-search"></i>
                </span>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Filter by name..."
                  value={nameFilter}
                  onChange={(e) => setNameFilter(e.target.value)}
                />
              </div>
            </div>
            <div className="col-auto">
              <label className="form-label small mb-1">Entry Time From</label>
              <input
                type="time"
                className="form-control form-control-sm"
                value={fromTime}
                onChange={(e) => setFromTime(e.target.value)}
              />
            </div>
            <div className="col-auto">
              <label className="form-label small mb-1">Entry Time To</label>
              <input
                type="time"
                className="form-control form-control-sm"
                value={toTime}
                onChange={(e) => setToTime(e.target.value)}
              />
            </div>
            {hasActiveFilters && (
              <div className="col-auto">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={clearFilters}
                  title="Clear name/time filters"
                >
                  <i className="bi bi-x-lg"></i>
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <p className="text-center text-muted p-4">Loading...</p>
          ) : error ? (
            <p className="text-center text-danger p-4">{error}</p>
          ) : (
            <div
              className="table-responsive"
              style={{ maxHeight: "70vh", overflowY: "auto" }}
            >
              <table className="table table-striped table-hover align-middle">
                <thead className="table-primary" style={{ position: "sticky", top: 0, zIndex: 1 }}>
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>Date</th>
                    <th>Entry Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.length === 0 ? (
                    <tr>
                      <td className="text-center text-muted" colSpan={4}>
                        {entries.length === 0
                          ? `No ${personType} entries${selectedDate ? ` for ${selectedDate}` : ""}.`
                          : "No entries match the selected filters."}
                      </td>
                    </tr>
                  ) : (
                    filteredEntries.map((e, index) => (
                      <tr key={e.id}>
                        <td>{index + 1}</td>
                        <td>{e.name}</td>
                        <td>{e.date}</td>
                        <td>
                          {e.marked_at
                            ? new Date(e.marked_at).toLocaleTimeString("en-IN")
                            : "-"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default EntryAttendance;
