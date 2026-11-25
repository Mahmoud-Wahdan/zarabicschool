// Preloaded via `node --require` by the `worker` npm script.
// `server-only` throws outside a React server environment and is not installed
// as a dependency, so plain Node cannot load it. Resolve it to this (empty)
// module instead. Only the exact request "server-only" is affected.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS preload hook.
const Module = require("node:module");

const originalResolve = Module._resolveFilename;

Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return __filename;
  return originalResolve.call(this, request, ...args);
};

module.exports = {};
