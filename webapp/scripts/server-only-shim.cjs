/** Lets fixture.ts import lib/ modules outside Next: loads .env (read only) and makes
    "server-only" an empty module. */
/* eslint-disable @typescript-eslint/no-require-imports */
const Module = require("module");
const resolve = Module._resolveFilename;
Module._resolveFilename = function resolveShim(request, ...rest) {
  if (request === "server-only") return __filename;
  return resolve.call(this, request, ...rest);
};
require("dotenv").config({ path: ".env", quiet: true });
