// One-time data-migration script. Existing applicant_name values sometimes
// bundle a person's initial into the same field, dot-separated in either
// order (e.g. "K.Yasir", "Yasir.K", "R.K. Charulatha" for two initials).
// Only names containing a "." are touched — space-separated names with no
// dot (e.g. "DINKAR SINGH") are ambiguous and left untouched rather than
// risk mangling a genuine two-word name.
require("dotenv").config();
const { Client } = require("pg");
const { splitNameInitial } = require("../utils/splitNameInitial");

const DRY_RUN = process.argv.includes("--dry-run");

const run = async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { require: true, rejectUnauthorized: false },
  });
  await client.connect();

  const { rows } = await client.query(
    'SELECT id, applicant_name FROM admissions WHERE applicant_name IS NOT NULL'
  );

  let changed = 0;
  let skipped = 0;

  for (const row of rows) {
    const result = splitNameInitial(row.applicant_name);
    if (!result) {
      skipped++;
      continue;
    }
    changed++;
    console.log(
      `#${row.id}: "${row.applicant_name}" -> name="${result.name}" initial="${result.initial}"`
    );
    if (!DRY_RUN) {
      await client.query(
        "UPDATE admissions SET applicant_name = $1, initial = $2 WHERE id = $3",
        [result.name, result.initial, row.id]
      );
    }
  }

  console.log(`\n${changed} rows ${DRY_RUN ? "would be" : "were"} updated, ${skipped} left unchanged.`);
  await client.end();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
