/* eslint-disable @typescript-eslint/no-require-imports */
require("dotenv").config({ path: "../.env" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run tests.");
}

const devHostSuffixes = [".supabase.co", ".pooler.supabase.com"];
const allowedHost = process.env.TEST_ALLOWED_DB_HOST;
let host;
try {
  host = new URL(databaseUrl).hostname;
} catch {
  throw new Error("DATABASE_URL is not a valid URL.");
}

const hostAllowed = allowedHost
  ? host === allowedHost
  : devHostSuffixes.some((suffix) => host.endsWith(suffix));

if (!hostAllowed) {
  throw new Error(
    "Tests are restricted to the known dev database host. Check that DATABASE_URL points at the dev database, or set TEST_ALLOWED_DB_HOST to its exact host."
  );
}
