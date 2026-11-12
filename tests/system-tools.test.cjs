const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { registerSystemTools } = require("../electron/system-tools.cjs");
test("프로젝트에 등록된 서비스만 실행하고 출력을 보존한다", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "flowrium-service-"));
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ scripts: { check: 'node -e "console.log(123456)"' } }),
  );
  const api = {};
  const manager = registerSystemTools((n, f) => (api[n] = f), {
    project: () => ({ path: dir }),
  });
  t.after(async () => {
    await manager.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });
  assert.deepEqual(await api.projectScripts("test"), ["check"]);
  await assert.rejects(api.runService("test", "invalid"), /등록된/);
  const s = await api.runService("test", "check");
  const deadline = Date.now() + 10000;
  let latest;
  do {
    latest = (await api.listServices()).find((v) => v.id === s.id);
    if (latest.state === "done") break;
    await new Promise((r) => setTimeout(r, 70));
  } while (Date.now() < deadline);
  assert.equal(latest.state, "done");
  assert.equal(latest.code, 0);
  assert.match(latest.output, /123456/);
  await assert.rejects(api.stopSystemProcess(process.pid));
  const rows = await api.systemProcesses();
  assert(rows.some((v) => v.pid === process.pid));
});
