const os = require("node:os");
const { setTimeout: delay } = require("node:timers/promises");

function cpuTimes() {
  const cores = os.cpus();
  let idle = 0;
  let total = 0;
  for (const { times } of cores) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.irq + times.idle;
  }
  return { count: cores.length, idle, total };
}

async function readSystemActivity() {
  const before = cpuTimes();
  await delay(300);
  const after = cpuTimes();
  const elapsed = after.total - before.total;
  const comparable = after.count === before.count && elapsed > 0;
  const busy = elapsed - (after.idle - before.idle);
  return {
    cpuPercent: comparable ? Math.min(100, Math.max(0, Math.round(100 * busy / elapsed))) : null,
    logicalCores: after.count,
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    measuredAt: new Date().toISOString(),
  };
}

module.exports = { readSystemActivity };
