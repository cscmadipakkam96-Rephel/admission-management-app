const Course = require("../models/Course");
const Teacher = require("../models/Teacher");
const REVIEW_KEYWORDS = require("../config/reviewKeywords");

const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

const RATING_LABELS = {
  1: "Poor",
  2: "Below Average",
  3: "Good",
  4: "Very Good",
  5: "Excellent",
};

// Public (unauthenticated) page — any student with the link can leave a
// review, same as the reference site. There's no student login/slug to
// scope this by, so course/teacher names are returned unscoped by admin_id
// (this deployment is effectively single-institute in practice today).
const getReviewFormOptions = async (req, res) => {
  try {
    const [courses, teachers] = await Promise.all([
      Course.findAll({ where: { active: true }, attributes: ["course_name"] }),
      Teacher.findAll({ where: { active: true }, attributes: ["teacher_name"] }),
    ]);
    res.status(200).json({
      success: true,
      data: {
        courses: [...new Set(courses.map((c) => c.course_name))].filter(Boolean).sort(),
        teachers: [...new Set(teachers.map((t) => t.teacher_name))].filter(Boolean).sort(),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const buildPrompt = ({ student_name, course_name, faculty_name, ratings }) => {
  const ratingLines = Object.entries(ratings)
    .map(([label, value]) => `- ${label}: ${value}/5 (${RATING_LABELS[value] || ""})`)
    .join("\n");

  return `You are writing a short Google review (3-5 sentences) from a student's own perspective about a computer training institute. Write in first person, natural and genuine — like a real student typed it themselves, not robotic or overly formal.

Details to weave in naturally (don't list them, write flowing sentences):
- Student's name: ${student_name}
- Institute name (mention it exactly once, naturally): ${REVIEW_KEYWORDS.companyName}
- Course completed: ${course_name}
${faculty_name ? `- Tutor/faculty name: ${faculty_name}` : ""}

Ratings (out of 5) — reflect these in your WORD CHOICE and TONE, do not print the numbers or "/5" anywhere in the review:
${ratingLines}

Rules:
- 4-5 rating -> describe warmly and positively.
- 3 rating -> describe as decent/average, not glowing.
- 1-2 rating -> mention it needs improvement, but stay constructive, not harsh.
- Never mention numeric ratings or the word "rating" in the output.
- Output ONLY the review text itself — no quotes, no heading, no preamble, no explanation.`;
};

const generateReview = async (req, res) => {
  try {
    const { student_name, course_name, faculty_name, ratings } = req.body;

    if (!student_name || !student_name.trim()) {
      return res.status(400).json({ success: false, message: "Student name is required." });
    }
    if (!course_name || !course_name.trim()) {
      return res.status(400).json({ success: false, message: "Course is required." });
    }
    if (
      !ratings ||
      typeof ratings !== "object" ||
      Object.keys(ratings).length === 0 ||
      Object.values(ratings).some((v) => !Number.isInteger(v) || v < 1 || v > 5)
    ) {
      return res.status(400).json({
        success: false,
        message: "Please rate every category with 1 to 5 stars.",
      });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "Review generation is not configured on the server yet.",
      });
    }

    const prompt = buildPrompt({
      student_name: student_name.trim(),
      course_name: course_name.trim(),
      faculty_name: (faculty_name || "").trim(),
      ratings,
    });

    const groqResponse = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 300,
      }),
    });

    const groqData = await groqResponse.json();
    if (!groqResponse.ok) {
      return res.status(502).json({
        success: false,
        message: groqData?.error?.message || "Failed to generate review right now.",
      });
    }

    const review = groqData.choices?.[0]?.message?.content?.trim();
    if (!review) {
      return res.status(502).json({ success: false, message: "Failed to generate review right now." });
    }

    res.status(200).json({ success: true, data: { review } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getReviewFormOptions, generateReview };
