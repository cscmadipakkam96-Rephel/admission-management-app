const SECTION_DAYS = {
  fast_track: [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
  ],
  normal_mwf: ["Monday", "Wednesday", "Friday"],
  normal_tts: ["Tuesday", "Thursday", "Saturday"],
  weekend: ["Saturday"],
};

const SECTION_LABELS = {
  fast_track: "Fast Track (Mon-Fri)",
  normal_mwf: "Normal Track (Mon/Wed/Fri)",
  normal_tts: "Normal Track (Tue/Thu/Sat)",
  weekend: "Weekend (Saturday)",
};

const VALID_SECTIONS = Object.keys(SECTION_DAYS);

const sectionsOverlapOnDays = (sectionA, sectionB) =>
  (SECTION_DAYS[sectionA] || []).some((day) =>
    (SECTION_DAYS[sectionB] || []).includes(day)
  );

const getTodayName = () =>
  new Date().toLocaleDateString("en-US", { weekday: "long" });

const isSectionActiveToday = (section) =>
  (SECTION_DAYS[section] || []).includes(getTodayName());

module.exports = {
  SECTION_DAYS,
  SECTION_LABELS,
  VALID_SECTIONS,
  sectionsOverlapOnDays,
  isSectionActiveToday,
  getTodayName,
};
