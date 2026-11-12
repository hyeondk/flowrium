const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  { randomUUID } = require("node:crypto");
const { Security } = require("../electron/security.cjs");
const { Drafts, registerDrafts } = require("../electron/drafts.cjs");
async function make(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "flowrium-drafts-"));
  t.after(() =>
    fs.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 100,
    }),
  );
  const auth = { account: { type: "chatgpt", email: "first@example.invalid" } };
  async function open() {
    const security = new Security(root);
    await security.load();
    const controller = {
      store: { state: { settings: {} } },
      client: {
        start: async () => {},
        request: async () => ({ account: auth.account }),
      },
    };
    const service = new Drafts(root, security, controller),
      api = {};
    registerDrafts(
      (k, fn) => (api[k] = (...a) => security.guard(k, () => fn(...a))),
      service,
    );
    return { security, service, api, controller };
  }
  return { root, auth, open, ...(await open()) };
}
test("기존 미전송 초안은 한 번 이관하고, 입력 중 변경 / 모드 / 앱 재시작을 복원하며 PIN 잠금 중에는 읽기와 쓰기를 거절한다", async (t) => {
  const { open, security, service, api } = await make(t);
  const key = "session:" + randomUUID(),
    original = { text: "미전송 기록", mode: "review" };
  await service.migrate(JSON.stringify({ [key]: original }));
  assert.deepEqual(await api.readDrafts(0), { [key]: original });
  await Promise.all([
    api.writeDrafts(0, { [key]: { text: "초안1", mode: "build" } }),
    api.writeDrafts(0, { [key]: { text: "최종 임시 입력", mode: "plan" } }),
  ]);
  await security.setPin("", "5678");
  security.lock();
  await assert.rejects(api.readDrafts(0), /잠겼습니다/);
  await assert.rejects(api.writeDrafts(0, { [key]: null }), /잠겼습니다/);
  await security.unlock("5678");
  const next = await open();
  await next.service.migrate(
    JSON.stringify({ [key]: { text: "오래된 중복 기록", mode: "review" } }),
  );
  await next.security.unlock("5678");
  assert.deepEqual((await next.api.readDrafts(0))[key], {
    text: "최종 임시 입력",
    mode: "plan",
  });
  await next.api.writeDrafts(0, { [key]: null });
  assert.deepEqual(await next.api.readDrafts(0), {});
});
test("로그아웃 / 외부 계정 교체 후 남은 이전 화면의 쓰기나 레거시 초안이 다른 계정으로 넘어가지 않는다", async (t) => {
  const { open, root, security, service, api, auth, controller } =
    await make(t);
  const key = "project:" + randomUUID(),
    draft = { text: "이전 계정 전용", mode: "plan" };
  await service.migrate(JSON.stringify({ [key]: draft }));
  assert.deepEqual((await api.readDrafts(0))[key], draft);
  auth.account = null;
  await security.accountOwner(null, true);
  await assert.rejects(api.writeDrafts(0, { [key]: draft }), /계정이 바뀌/);
  assert.deepEqual(await api.readDrafts(1), {});
  auth.account = { type: "chatgpt", email: "second@example.invalid" };
  await controller.accountObserved(auth.account);
  assert.equal(security.accountRevision, 2);
  assert.deepEqual(await api.readDrafts(2), {});
  await api.writeDrafts(2, { [key]: { ...draft, text: "새 계정 전용" } });
  const next = await open();
  await next.service.migrate(null);
  assert.equal(next.security.accountRevision, 2);
  assert.equal((await next.api.readDrafts(2))[key].text, "새 계정 전용");
  const data = await fs.readFile(path.join(root, "security.json"), "utf8");
  assert(!data.includes("@example.invalid"));
  await assert.rejects(
    next.api.writeDrafts(2, { "other/../test": draft }),
    /식별자/,
  );
});
