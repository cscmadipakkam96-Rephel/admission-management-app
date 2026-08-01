import { useEffect, useRef, useState } from "react";

const toDateStr = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const QUICK_RANGES = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "lastWeek", label: "Last Week" },
  { key: "month", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "all", label: "All Time" },
];

function AdmissionReportCard({
  admissions,
  feeEntries,
  courses,
  onRangeChange,
  variant = "standard",
}) {
  const todayStr = toDateStr(new Date());
  const earliestDateStr =
    admissions.reduce((min, a) => {
      if (!a.created_at) return min;
      const d = a.created_at.slice(0, 10);
      return !min || d < min ? d : min;
    }, null) || todayStr;
  // "All Time" must cover every record even if one was created "in the
  // future" relative to the viewer's current clock (e.g. entered on a
  // machine slightly ahead, or just past midnight) — so its upper bound is
  // whichever is later: today, or the latest admission's own date.
  const latestDateStr =
    admissions.reduce((max, a) => {
      if (!a.created_at) return max;
      const d = a.created_at.slice(0, 10);
      return !max || d > max ? d : max;
    }, null) || todayStr;
  const allTimeEndStr = latestDateStr > todayStr ? latestDateStr : todayStr;

  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [activePreset, setActivePreset] = useState("all");
  const hasInitializedRange = useRef(false);

  useEffect(() => {
    if (hasInitializedRange.current || admissions.length === 0) return;
    hasInitializedRange.current = true;
    setStartDate(earliestDateStr);
    setEndDate(allTimeEndStr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admissions.length]);

  useEffect(() => {
    onRangeChange?.({ startDate, endDate });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  const selectQuickRange = (key) => {
    setActivePreset(key);
    const now = new Date();
    const nowStr = toDateStr(now);

    if (key === "today") {
      setStartDate(nowStr);
      setEndDate(nowStr);
    } else if (key === "week") {
      const dayOfWeek = now.getDay();
      const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(now);
      monday.setDate(now.getDate() - daysSinceMonday);
      setStartDate(toDateStr(monday));
      setEndDate(nowStr);
    } else if (key === "lastWeek") {
      const dayOfWeek = now.getDay();
      const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const thisMonday = new Date(now);
      thisMonday.setDate(now.getDate() - daysSinceMonday);
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(thisMonday.getDate() - 7);
      const lastSunday = new Date(thisMonday);
      lastSunday.setDate(thisMonday.getDate() - 1);
      setStartDate(toDateStr(lastMonday));
      setEndDate(toDateStr(lastSunday));
    } else if (key === "month") {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      setStartDate(toDateStr(firstOfMonth));
      setEndDate(nowStr);
    } else if (key === "lastMonth") {
      const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      setStartDate(toDateStr(firstOfLastMonth));
      setEndDate(toDateStr(lastOfLastMonth));
    } else if (key === "all") {
      setStartDate(earliestDateStr);
      setEndDate(allTimeEndStr);
    }
  };

  const handleStartDateChange = (e) => {
    setStartDate(e.target.value);
    setActivePreset("");
  };

  const handleEndDateChange = (e) => {
    setEndDate(e.target.value);
    setActivePreset("");
  };

  const dateFilteredAdmissions = admissions.filter((a) => {
    if (!a.created_at) return false;
    const d = toDateStr(new Date(a.created_at));
    return d >= startDate && d <= endDate;
  });

  const dateFilteredFeeEntries = feeEntries.filter(
    (e) => e.paid_date && e.paid_date >= startDate && e.paid_date <= endDate
  );

  const reportStats = (() => {
    const totalPerson = dateFilteredAdmissions.length;

    const bv = dateFilteredAdmissions.reduce((sum, a) => {
      if (
        a.total_fee !== null &&
        a.total_fee !== undefined &&
        a.total_fee !== ""
      ) {
        return sum + Number(a.total_fee);
      }
      const matchedCourse = courses.find(
        (c) =>
          (c.course_name || "").trim().toLowerCase() ===
          (a.course_name || "").trim().toLowerCase()
      );
      if (
        matchedCourse &&
        matchedCourse.standard_fee !== null &&
        matchedCourse.standard_fee !== undefined &&
        matchedCourse.standard_fee !== ""
      ) {
        return sum + Number(matchedCourse.standard_fee);
      }
      return sum;
    }, 0);

    // CR must be scoped to the SAME cohort as BV (admissions within this
    // date range), not by when the payment was made — otherwise an older
    // student's installment paid this month leaks into "this month's CR"
    // while BV only counts this month's own admissions, pushing CR% > 100%.
    const cohortEnrolNos = new Set(
      dateFilteredAdmissions.map((a) => a.comn_enrol_no).filter(Boolean)
    );
    const cr = feeEntries
      .filter((e) => cohortEnrolNos.has(e.enrol_no))
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const collection = dateFilteredFeeEntries.reduce(
      (sum, e) => sum + (Number(e.amount) || 0),
      0
    );

    const gpayTotal = dateFilteredFeeEntries
      .filter((e) => (e.payment_mode || "").toLowerCase() === "gpay")
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const cashTotal = dateFilteredFeeEntries
      .filter((e) => (e.payment_mode || "").toLowerCase() === "cash")
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const crPercent = bv > 0 ? (cr / bv) * 100 : 0;
    const avgPerHead = totalPerson > 0 ? bv / totalPerson : 0;

    return {
      totalPerson,
      bv,
      cr,
      collection,
      gpayTotal,
      cashTotal,
      crPercent,
      avgPerHead,
    };
  })();

  return (
    <div className="card shadow-sm mb-3">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-3 mb-3">
          <div className="d-flex gap-2 flex-wrap">
            {QUICK_RANGES.map((range) => (
              <button
                key={range.key}
                type="button"
                className={`btn btn-sm ${activePreset === range.key ? "btn-primary" : "btn-outline-primary"}`}
                onClick={() => selectQuickRange(range.key)}
              >
                {range.label}
              </button>
            ))}
          </div>
          <div className="d-flex align-items-end gap-2">
            <div>
              <label className="form-label small mb-1">Start Date</label>
              <input
                type="date"
                className="form-control form-control-sm"
                value={startDate}
                max={endDate}
                onChange={handleStartDateChange}
              />
            </div>
            <div>
              <label className="form-label small mb-1">End Date</label>
              <input
                type="date"
                className="form-control form-control-sm"
                value={endDate}
                min={startDate}
                max={allTimeEndStr}
                onChange={handleEndDateChange}
              />
            </div>
          </div>
        </div>
        {variant === "admission" ? (
          <div className="row g-3 text-center">
            <div className="col-6 col-md-2">
              <div className="text-muted small text-uppercase fw-bold">
                Admission Count
              </div>
              <div className="fs-4 fw-bold text-dark">
                {reportStats.totalPerson}
              </div>
            </div>
            <div className="col-6 col-md-2">
              <div
                className="text-muted small text-uppercase fw-bold"
                title="Total fee billed for Admission-list persons only (uses Course fee when not set on Admission)"
              >
                Business Value (BV)
              </div>
              <div className="fs-4 fw-bold text-primary">
                Rs. {reportStats.bv.toLocaleString("en-IN")}
              </div>
            </div>
            <div className="col-6 col-md-2">
              <div
                className="text-muted small text-uppercase fw-bold"
                title="Total collected from Admission-list persons only"
              >
                Cash Realization (CR)
              </div>
              <div className="fs-4 fw-bold text-success">
                Rs. {reportStats.cr.toLocaleString("en-IN")}
              </div>
            </div>
            <div className="col-6 col-md-2">
              <div
                className="text-muted small text-uppercase fw-bold"
                title="CR ÷ BV × 100"
              >
                CR%
              </div>
              <div className="fs-4 fw-bold text-info">
                {reportStats.crPercent.toFixed(1)}%
              </div>
            </div>
            <div className="col-6 col-md-2">
              <div
                className="text-muted small text-uppercase fw-bold"
                title="BV ÷ Admission Count"
              >
                Average Per Head
              </div>
              <div className="fs-4 fw-bold text-warning">
                Rs.{" "}
                {reportStats.avgPerHead.toLocaleString("en-IN", {
                  maximumFractionDigits: 0,
                })}
              </div>
            </div>
            <div className="col-6 col-md-2">
              <div
                className="text-muted small text-uppercase fw-bold"
                title="Total collected from Admission + Non-Admission persons combined"
              >
                Collection
              </div>
              <div className="fs-4 fw-bold text-success">
                Rs. {reportStats.collection.toLocaleString("en-IN")}
              </div>
            </div>
          </div>
        ) : (
          <div className="row g-3 text-center">
            <div className="col-6 col-md-2">
              <div className="text-muted small text-uppercase fw-bold">
                Total Person
              </div>
              <div className="fs-4 fw-bold text-dark">
                {reportStats.totalPerson}
              </div>
            </div>
            <div className="col-6 col-md-2">
              <div
                className="text-muted small text-uppercase fw-bold"
                title="Total fee billed for Admission-list persons only (uses Course fee when not set on Admission)"
              >
                BV
              </div>
              <div className="fs-4 fw-bold text-primary">
                Rs. {reportStats.bv.toLocaleString("en-IN")}
              </div>
            </div>
            <div className="col-6 col-md-2">
              <div
                className="text-muted small text-uppercase fw-bold"
                title="Total collected from Admission-list persons only"
              >
                CR
              </div>
              <div className="fs-4 fw-bold text-success">
                Rs. {reportStats.cr.toLocaleString("en-IN")}
              </div>
            </div>
            <div className="col-6 col-md-2">
              <div
                className="text-muted small text-uppercase fw-bold"
                title="Total collected from Admission + Non-Admission persons combined"
              >
                Collection
              </div>
              <div className="fs-4 fw-bold text-success">
                Rs. {reportStats.collection.toLocaleString("en-IN")}
              </div>
            </div>
            <div className="col-6 col-md-2">
              <div
                className="text-muted small text-uppercase fw-bold"
                title="Total paid via GPay — Admission + Non-Admission combined"
              >
                GPay Total
              </div>
              <div className="fs-4 fw-bold text-info">
                Rs. {reportStats.gpayTotal.toLocaleString("en-IN")}
              </div>
            </div>
            <div className="col-6 col-md-2">
              <div
                className="text-muted small text-uppercase fw-bold"
                title="Total paid via Cash — Admission + Non-Admission combined"
              >
                Cash Total
              </div>
              <div className="fs-4 fw-bold text-warning">
                Rs. {reportStats.cashTotal.toLocaleString("en-IN")}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdmissionReportCard;
