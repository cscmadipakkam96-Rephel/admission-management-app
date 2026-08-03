import { useRef } from "react";
import { Bar, Line } from "react-chartjs-2";
import jsPDF from "jspdf";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend
);

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const toDateStr = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const pointValueLabelPlugin = {
  id: "pointValueLabelPlugin",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      meta.data.forEach((point, index) => {
        const value = dataset.data[index];
        if (!value) return;
        ctx.save();
        ctx.fillStyle = "#1d4ed8";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(value, point.x, point.y - 10);
        ctx.restore();
      });
    });
  },
};

function buildTimeSeriesData(admissions, startDate, endDate) {
  const from = new Date(`${startDate}T00:00:00`);
  const to = new Date(`${endDate}T23:59:59`);

  const inRange = admissions.filter((a) => {
    if (!a.created_at) return false;
    const created = new Date(a.created_at);
    return created >= from && created <= to;
  });

  // Diff midnight-to-midnight (not `to`'s 23:59:59) so a full 31-day month
  // computes exactly 31, not 32 — the extra day was pushing it past the
  // day-bucket threshold into month-bucketing, collapsing 31 days into
  // a single "Jul 2026" point instead of a full daily trend line.
  const toMidnight = new Date(`${endDate}T00:00:00`);
  const dayCount =
    Math.round((toMidnight - from) / (1000 * 60 * 60 * 24)) + 1;

  const buckets = new Map();
  const order = [];

  if (dayCount <= 31) {
    for (let i = 0; i < dayCount; i++) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      const key = toDateStr(d);
      const label = `${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`;
      buckets.set(key, 0);
      order.push({ key, label });
    }
    inRange.forEach((a) => {
      const key = toDateStr(new Date(a.created_at));
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
    });
  } else {
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    const endMonth = new Date(to.getFullYear(), to.getMonth(), 1);
    while (cursor <= endMonth) {
      const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
      const label = `${MONTH_LABELS[cursor.getMonth()]} ${cursor.getFullYear()}`;
      buckets.set(key, 0);
      order.push({ key, label });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    inRange.forEach((a) => {
      const d = new Date(a.created_at);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
    });
  }

  return {
    labels: order.map((o) => o.label),
    datasets: [
      {
        label: "Admissions",
        data: order.map((o) => buckets.get(o.key)),
        borderColor: "#1d4ed8",
        backgroundColor: "rgba(29, 78, 216, 0.15)",
        tension: 0.3,
        fill: true,
        pointRadius: 3,
      },
    ],
  };
}

const CHART_FIELDS = [
  { field: "course_name", label: "Students by Course", color: "#7c3aed" },
  {
    field: "age",
    label: "Students by Age Group",
    color: "#ea580c",
    isAge: true,
  },
  {
    field: "timings",
    label: "Students by Batch Timing",
    color: "#16a34a",
    isTiming: true,
  },
  {
    field: "educational_qualification",
    label: "Students by Qualification",
    color: "#0891b2",
    isQualification: true,
  },
];

const AGE_BUCKETS = [
  { label: "Under 18", min: 0, max: 17 },
  { label: "18-25", min: 18, max: 25 },
  { label: "26-35", min: 26, max: 35 },
  { label: "36-45", min: 36, max: 45 },
  { label: "46+", min: 46, max: Infinity },
];

// Educational qualification is free-typed at admission, so bucket it into
// standard levels via keyword matching (checked highest-level first) instead
// of charting the raw text, which is almost always unique per record.
const QUALIFICATION_RULES = [
  { label: "PG", keywords: ["MBA", "M.COM", "MCOM", "M.SC", "MSC", "M.A", "M.TECH", "MTECH"] },
  {
    label: "UG",
    keywords: [
      "B.COM", "BCOM", "BBA", "B.TECH", "BTECH", "B.E", "B.SC", "BSC",
      "B.A", "BCA", "U.G", "DEGREE",
    ],
  },
  { label: "Diploma", keywords: ["DIPLOMA"] },
  {
    label: "12th",
    keywords: [
      "12TH", "12 TH", "+2", "+1", "HSC", "PLUS TWO", "PLUS ONE",
      "HR SEC", "HR.SEC", "HR. SEC", "SR SEC", "SR.SEC", "SR. SEC",
    ],
  },
  { label: "10th & Below", keywords: ["10TH", "9TH", "8TH", "SSLC", "STD"] },
];

const QUALIFICATION_LABELS = QUALIFICATION_RULES.map((r) => r.label);

const classifyQualification = (raw) => {
  if (!raw || !raw.trim()) return "Unknown";
  const trimmed = raw.trim();

  // Admission form now has a dropdown using these exact labels — match
  // directly before falling back to keyword-guessing on older free-typed
  // entries (where bare "UG"/"PG" would otherwise be too ambiguous to
  // safely keyword-match as a substring).
  const exactMatch = QUALIFICATION_LABELS.find(
    (label) => label.toLowerCase() === trimmed.toLowerCase()
  );
  if (exactMatch) return exactMatch;
  if (trimmed.toLowerCase() === "other") return "Other";

  const s = trimmed.toUpperCase();
  const rule = QUALIFICATION_RULES.find((r) =>
    r.keywords.some((kw) => s.includes(kw))
  );
  return rule ? rule.label : "Other";
};

const groupBy = (admissions, valueOf) => {
  const groups = {};
  admissions.forEach((row) => {
    const value = valueOf(row);
    if (!groups[value]) groups[value] = [];
    groups[value].push(row);
  });
  return groups;
};

const buildQualificationChartData = (admissions, label, color) => {
  const groups = groupBy(admissions, (row) =>
    classifyQualification(row.educational_qualification)
  );
  return {
    labels: Object.keys(groups),
    datasets: [
      {
        label,
        data: Object.values(groups).map((rows) => rows.length),
        backgroundColor: color,
        borderRadius: 4,
      },
    ],
    groups,
  };
};

const buildChartData = (admissions, field, label, color) => {
  const groups = groupBy(admissions, (row) => row[field] || "Unknown");
  return {
    labels: Object.keys(groups),
    datasets: [
      {
        label,
        data: Object.values(groups).map((rows) => rows.length),
        backgroundColor: color,
        borderRadius: 4,
      },
    ],
    groups,
  };
};

// Timings are free-typed at admission ("4 to 6pm", "4-6pm", "10-12PM",
// "10-12"...) so the same slot ends up as several near-duplicate bars.
// Normalize to a single canonical "start-end PERIOD" form before counting.
const normalizeTiming = (raw) => {
  if (!raw || !raw.trim()) return "Unknown";
  let s = raw.trim().toUpperCase().replace(/\s*TO\s*/g, "-");
  s = s.replace(/\s+/g, "");
  const match = s.match(/^(\d{1,2})-(\d{1,2})(AM|PM)?$/);
  if (!match) return raw.trim();
  const [, start, end, period] = match;
  return `${start}-${end} ${period || "PM"}`;
};

// Sort key in minutes-from-midnight, so bars read left-to-right in actual
// time order instead of first-seen-in-data order. Course batches only ever
// run 9 AM–8 PM, so hours 9-12 are treated as morning and 1-8 as afternoon/
// evening — more reliable than trusting normalizeTiming's single guessed
// AM/PM suffix (which can be wrong for crossover ranges like "11-1").
const timingSortKey = (label) => {
  const match = label.match(/^(\d{1,2})-\d{1,2} (AM|PM)/);
  if (!match) return Infinity;
  const start = parseInt(match[1], 10);
  const hour24 = start >= 9 && start <= 12 ? start : start + 12;
  return hour24 * 60;
};

const buildTimingChartData = (admissions, label, color) => {
  const groups = groupBy(admissions, (row) => normalizeTiming(row.timings));
  const sortedLabels = Object.keys(groups).sort(
    (a, b) => timingSortKey(a) - timingSortKey(b)
  );
  return {
    labels: sortedLabels,
    datasets: [
      {
        label,
        data: sortedLabels.map((l) => groups[l].length),
        backgroundColor: color,
        borderRadius: 4,
      },
    ],
    groups,
  };
};

const buildAgeChartData = (admissions, label, color) => {
  const groups = groupBy(admissions, (row) => {
    const age = row.age;
    if (age === null || age === undefined) return "Unknown";
    const bucket = AGE_BUCKETS.find((b) => age >= b.min && age <= b.max);
    return bucket ? bucket.label : "Unknown";
  });
  AGE_BUCKETS.forEach((b) => {
    if (!groups[b.label]) groups[b.label] = [];
  });
  const labels = AGE_BUCKETS.map((b) => b.label);
  if (groups["Unknown"]?.length) labels.push("Unknown");
  const data = labels.map((l) => groups[l].length);
  return {
    labels,
    datasets: [{ label, data, backgroundColor: color, borderRadius: 4 }],
    groups,
  };
};

function AdmissionCharts({ admissions, startDate, endDate, onSegmentClick }) {
  const lineChartRef = useRef(null);
  const barChartRefs = useRef({});

  if (admissions.length === 0 || !startDate || !endDate) return null;

  const filteredAdmissions = admissions.filter((a) => {
    if (!a.created_at) return false;
    const from = new Date(`${startDate}T00:00:00`);
    const to = new Date(`${endDate}T23:59:59`);
    const created = new Date(a.created_at);
    return created >= from && created <= to;
  });

  const filterDescription = `${startDate} to ${endDate}`;

  const exportChartsToPDF = () => {
    const doc = new jsPDF({ orientation: "portrait" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 10;
    const imgWidth = pageWidth - margin * 2;

    doc.setFontSize(14);
    doc.text("Admission Analytics", margin, 15);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Showing: ${filterDescription}`, margin, 20);
    doc.setTextColor(0);

    let y = 26;
    if (lineChartRef.current) {
      const lineImg = lineChartRef.current.toBase64Image();
      doc.addImage(lineImg, "PNG", margin, y, imgWidth, imgWidth * 0.4);
      y += imgWidth * 0.4 + 10;
    }

    const barWidth = (imgWidth - 10) / 2;
    let col = 0;
    CHART_FIELDS.forEach((chart) => {
      const chartInstance = barChartRefs.current[chart.field];
      if (!chartInstance) return;
      const img = chartInstance.toBase64Image();
      const x = margin + col * (barWidth + 10);
      doc.addImage(img, "PNG", x, y, barWidth, barWidth * 0.75);
      col += 1;
      if (col === 2) {
        col = 0;
        y += barWidth * 0.75 + 10;
      }
    });

    doc.save("admission_analytics.pdf");
  };

  return (
    <div className="admission-list mt-4">
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <h2 className="mb-0">Admission Analytics</h2>
        <div className="d-flex align-items-center gap-2">
          <span className="badge bg-primary fs-6">
            Admission Total: {filteredAdmissions.length}
          </span>
          <button
            type="button"
            className="btn btn-outline-danger btn-sm d-flex align-items-center gap-1"
            onClick={exportChartsToPDF}
          >
            <i className="bi bi-file-earmark-pdf"></i> Export Charts as PDF
          </button>
        </div>
      </div>

      <div className="border rounded p-3 mb-4">
        <h5 className="mb-2">Admissions Over Time</h5>
        <Line
          ref={lineChartRef}
          data={buildTimeSeriesData(filteredAdmissions, startDate, endDate)}
          plugins={[pointValueLabelPlugin]}
          options={{
            responsive: true,
            layout: { padding: { top: 20 } },
            plugins: {
              legend: { display: false },
            },
            scales: {
              y: { beginAtZero: true, ticks: { precision: 0 } },
            },
          }}
        />
      </div>

      <div className="row g-4">
        {CHART_FIELDS.map((chart) => {
          const chartData = chart.isAge
            ? buildAgeChartData(filteredAdmissions, chart.label, chart.color)
            : chart.isTiming
              ? buildTimingChartData(filteredAdmissions, chart.label, chart.color)
              : chart.isQualification
                ? buildQualificationChartData(
                    filteredAdmissions,
                    chart.label,
                    chart.color
                  )
                : buildChartData(
                    filteredAdmissions,
                    chart.field,
                    chart.label,
                    chart.color
                  );
          return (
            <div className="col-md-6" key={chart.field}>
              <div className="border rounded p-3 h-100">
                <Bar
                  ref={(el) => {
                    barChartRefs.current[chart.field] = el;
                  }}
                  data={chartData}
                  options={{
                    responsive: true,
                    onClick: (_event, elements) => {
                      if (!elements.length || !onSegmentClick) return;
                      const clickedLabel = chartData.labels[elements[0].index];
                      const matched = chartData.groups[clickedLabel] || [];
                      onSegmentClick(chart.label, clickedLabel, matched);
                    },
                    onHover: (event, elements) => {
                      event.native.target.style.cursor = elements.length
                        ? "pointer"
                        : "default";
                    },
                    plugins: {
                      legend: { display: false },
                      title: { display: true, text: chart.label },
                    },
                    scales: {
                      y: { beginAtZero: true, ticks: { precision: 0 } },
                    },
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default AdmissionCharts;
