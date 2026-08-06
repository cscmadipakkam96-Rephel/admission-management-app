import { useEffect, useState } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import API from "../../api/api";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// Shared between Batch Management and Subject Management — same
// Completed/Not Completed/Total/Not Assigned bar chart with click-to-drill
// down into the actual student list, backed by the same admin endpoint.
function SubjectCompletionChart() {
  const [subjectChart, setSubjectChart] = useState([]);
  const [chartDrilldown, setChartDrilldown] = useState(null);
  const [expandedDrilldownStudentKey, setExpandedDrilldownStudentKey] = useState(null);

  useEffect(() => {
    const fetchSubjectChart = async () => {
      try {
        const response = await API.get("/batches/subject-completion-chart");
        setSubjectChart(response.data.data);
      } catch {
        // Secondary feature; ignore failures silently.
      }
    };
    fetchSubjectChart();
  }, []);

  return (
    <div className="card shadow-sm mt-4">
      <div className="card-body">
        <h4 className="mb-3">Subject-wise Completion — Students</h4>
        {subjectChart.length === 0 ? (
          <div className="text-muted small">
            No batches with a day-target (num_days) set yet.
          </div>
        ) : (
          <>
            <div style={{ maxWidth: "700px" }}>
              <Bar
                data={{
                  labels: subjectChart.map((s) => s.subject_name),
                  datasets: [
                    {
                      label: "Completed",
                      data: subjectChart.map((s) => s.completedCount),
                      backgroundColor: "#16a34a",
                      borderRadius: 4,
                    },
                    {
                      label: "Not Completed",
                      data: subjectChart.map((s) => s.notCompletedCount),
                      backgroundColor: "#dc2626",
                      borderRadius: 4,
                    },
                    {
                      label: "Total Students in Subject",
                      data: subjectChart.map((s) => s.totalStudents),
                      backgroundColor: "#2563eb",
                      borderRadius: 4,
                    },
                    {
                      label: "Not Assigned to Batch",
                      data: subjectChart.map((s) => s.notAssignedCount),
                      backgroundColor: "#f59e0b",
                      borderRadius: 4,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  onClick: (_event, elements) => {
                    if (!elements.length) return;
                    const { datasetIndex, index } = elements[0];
                    if (datasetIndex === 2) return; // Total bar — informational only, no drilldown list
                    const subject = subjectChart[index];
                    setExpandedDrilldownStudentKey(null);
                    if (datasetIndex === 3) {
                      setChartDrilldown({
                        subject_name: subject.subject_name,
                        status: "Not Assigned",
                        students: subject.notAssignedStudents,
                      });
                      return;
                    }
                    const isCompleted = datasetIndex === 0;
                    setChartDrilldown({
                      subject_name: subject.subject_name,
                      status: isCompleted ? "Completed" : "Not Completed",
                      students: isCompleted
                        ? subject.completedStudents
                        : subject.notCompletedStudents,
                    });
                  },
                  onHover: (event, elements) => {
                    event.native.target.style.cursor = elements.length
                      ? "pointer"
                      : "default";
                  },
                  plugins: {
                    legend: { position: "top" },
                    title: {
                      display: true,
                      text: "Completed vs Not Completed Students (per Subject)",
                    },
                  },
                  scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                  },
                }}
              />
            </div>

            {chartDrilldown && (
              <div className="border rounded p-3 mt-3">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <h6 className="mb-0">
                    {chartDrilldown.subject_name} —{" "}
                    <span
                      className={
                        chartDrilldown.status === "Completed"
                          ? "text-success"
                          : chartDrilldown.status === "Not Assigned"
                            ? "text-warning"
                            : "text-danger"
                      }
                    >
                      {chartDrilldown.status}
                    </span>{" "}
                    ({chartDrilldown.students.length})
                  </h6>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => setChartDrilldown(null)}
                  ></button>
                </div>
                {chartDrilldown.students.length === 0 ? (
                  <div className="text-muted small">No students in this group.</div>
                ) : (
                  chartDrilldown.students.map((st) => {
                    const key = st.id;
                    const isStudentOpen = expandedDrilldownStudentKey === key;
                    return (
                      <div key={key} className="border rounded p-2 mb-2">
                        <div
                          role="button"
                          className="d-flex justify-content-between align-items-center"
                          onClick={() =>
                            setExpandedDrilldownStudentKey(
                              isStudentOpen ? null : key
                            )
                          }
                        >
                          <div className="small">
                            <strong>{st.applicant_name}</strong>
                            {st.comn_enrol_no && (
                              <span className="text-muted"> ({st.comn_enrol_no})</span>
                            )}
                            {st.enrollments?.length > 1 && (
                              <span className="badge bg-info text-dark ms-2">
                                {st.enrollments.length} teachers
                              </span>
                            )}
                            {!st.enrollments && (
                              <span className="badge bg-warning text-dark ms-2">
                                No batch yet
                              </span>
                            )}
                          </div>
                          <i
                            className={`bi ${isStudentOpen ? "bi-chevron-up" : "bi-chevron-down"} text-muted`}
                          ></i>
                        </div>
                        {isStudentOpen && (
                          <div className="small mt-2">
                            <div className="text-muted mb-2">
                              <strong>Subject:</strong> {chartDrilldown.subject_name}
                            </div>
                            {!st.enrollments && (
                              <div className="text-muted">
                                <strong>Course:</strong> {st.course_name || "-"}
                                <div className="mt-1">
                                  Admitted for this subject, but not yet added to any
                                  batch teaching it.
                                </div>
                              </div>
                            )}
                            {st.enrollments &&
                              st.enrollments.map((en) => (
                                <div
                                  key={en.batch_id}
                                  className="border-top pt-2 mt-2"
                                >
                                  <div>
                                    <strong>Teacher:</strong> {en.teacher_name}{" "}
                                    <span className="text-muted">— Batch: {en.batch_name}</span>
                                  </div>
                                  <div className="text-muted">
                                    <strong>Classes attended:</strong> {en.presentCount} of{" "}
                                    {en.num_days} (duration){" "}
                                    {en.completed ? (
                                      <span className="badge bg-success ms-1">Completed</span>
                                    ) : (
                                      <span className="badge bg-danger ms-1">Not Completed</span>
                                    )}
                                  </div>

                                  {chartDrilldown.status === "Completed" ? (
                                    <div className="mt-1">
                                      <div className="fw-semibold text-success">
                                        Topics Completed ({en.completedTopics.length})
                                      </div>
                                      {en.completedTopics.length === 0 ? (
                                        <div className="text-muted">None yet</div>
                                      ) : (
                                        en.completedTopics.map((t) => (
                                          <div key={t.date}>
                                            <i className="bi bi-check-circle-fill text-success me-1"></i>
                                            <span className="text-muted">{t.date}</span> —{" "}
                                            {t.topic_covered}
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  ) : (
                                    <div className="mt-1">
                                      <div className="fw-semibold text-danger">
                                        Topics Missed ({en.missedTopics.length})
                                      </div>
                                      {en.missedTopics.length === 0 ? (
                                        <div className="text-muted">None</div>
                                      ) : (
                                        en.missedTopics.map((t) => (
                                          <div key={t.date}>
                                            <i className="bi bi-x-circle-fill text-danger me-1"></i>
                                            <span className="text-muted">{t.date}</span> —{" "}
                                            {t.topic_covered}
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default SubjectCompletionChart;
