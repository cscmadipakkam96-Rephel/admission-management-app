require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client } = require("pg");
const path = require("path");
const XLSX = require(path.join(__dirname, "..", "..", "client", "node_modules", "xlsx"));

const sanitizeSheetName = (name, usedNames) => {
  let clean = name.replace(/[\\/?*[\]:]/g, "_").slice(0, 31);
  let candidate = clean;
  let i = 1;
  while (usedNames.has(candidate)) {
    const suffix = `_${i++}`;
    candidate = clean.slice(0, 31 - suffix.length) + suffix;
  }
  usedNames.add(candidate);
  return candidate;
};

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { require: true, rejectUnauthorized: false },
  });
  await client.connect();

  const { rows: tables } = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  const workbook = XLSX.utils.book_new();
  const usedNames = new Set();

  for (const { table_name } of tables) {
    const { rows } = await client.query(`SELECT * FROM "${table_name}"`);
    const sheetData =
      rows.length > 0
        ? rows
        : [{ note: "No rows in this table" }];
    const worksheet = XLSX.utils.json_to_sheet(sheetData);
    const sheetName = sanitizeSheetName(table_name, usedNames);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    console.log(`  ${table_name}: ${rows.length} rows`);
  }

  const outPath = path.join(__dirname, "..", "course_admission_full_export.xlsx");
  XLSX.writeFile(workbook, outPath);
  console.log(`\nDone. Tables exported: ${tables.length}`);
  console.log(`File: ${outPath}`);

  await client.end();
})().catch((err) => {
  console.error("Export failed:", err.message);
  process.exit(1);
});
