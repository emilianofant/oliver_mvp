const { runMigrations } = require("./db");

runMigrations()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[migrate] failed: ${err.message}`);
    process.exit(1);
  });
