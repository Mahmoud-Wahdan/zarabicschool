/**
 * Measurement preload (L1, 2026-10-28), loaded with NODE_OPTIONS="--require ...":
 *  - PERF_QUERY_LOG=<file>: every pg query appends "<end ms epoch> <duration ms>" to
 *    the file. No SQL text, no parameters, no data. <file>.pids lists the processes
 *    that loaded the preload.
 *  - PERF_NO_WORKER=1: marks the notification worker as already started, so a local
 *    production server never runs the WhatsApp worker during a measurement.
 * App code is unchanged.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const Module = require("module");

const logFile = process.env.PERF_QUERY_LOG;
if (logFile) fs.appendFileSync(`${logFile}.pids`, `${process.pid} ${process.argv[1] ?? ""}\n`);
if (process.env.PERF_NO_WORKER === "1") globalThis.__zarabicWorkerStarted = true;

function patch(pg) {
  const Client = pg && pg.Client;
  if (!Client || Client.prototype.__perfPatched) return;
  Client.prototype.__perfPatched = true;
  const original = Client.prototype.query;
  Client.prototype.query = function patchedQuery(...args) {
    const started = performance.now();
    let logged = false;
    const done = () => {
      if (logged) return;
      logged = true;
      fs.appendFileSync(logFile, `${Date.now()} ${(performance.now() - started).toFixed(1)}\n`);
    };
    // Three call shapes: promise, node callback (what pg.Pool uses), or a query object.
    const last = args[args.length - 1];
    if (typeof last === "function") {
      args[args.length - 1] = function callbackDone(...results) {
        done();
        return last.apply(this, results);
      };
    } else if (args[0] && typeof args[0].callback === "function") {
      const callback = args[0].callback;
      args[0].callback = function submittableDone(...results) {
        done();
        return callback.apply(this, results);
      };
    }
    const result = original.apply(this, args);
    if (result && typeof result.then === "function") result.then(done, done);
    return result;
  };
}

if (logFile) {
  try {
    patch(require(require.resolve("pg", { paths: [process.cwd()] })));
  } catch {
    // pg not resolvable from here: the load hook below still patches it.
  }
  // Next loads pg through its own external alias (.next/.../node_modules/pg-<hash>),
  // so patch every pg module instance as it is first loaded, whatever its path.
  const load = Module._load;
  Module._load = function loadAndPatch(request, ...rest) {
    const exported = load.call(this, request, ...rest);
    if (/(^|[\\/])pg(-[0-9a-f]+)?$/.test(request)) patch(exported);
    return exported;
  };
}
