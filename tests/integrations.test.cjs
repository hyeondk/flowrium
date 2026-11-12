const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { registerIntegrations } = require("../electron/integrations.cjs");
test("연동 설정 암호화와 OAuth 상태·잘못된 콜백 차단", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "flowrium-google-")),
    api = {},
    urls = [];
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (v) => Buffer.from("encrypted:" + v),
    decryptString: (v) => v.toString().slice(10),
  };
  const runtime = registerIntegrations(
    (n, f) => (api[n] = f),
    {},
    {
      directory: dir,
      secretStorage: storage,
      openExternal: async (u) => urls.push(u),
      fetchImpl: async () => {
        throw Error("실제 계정 호출 없음");
      },
    },
  );
  t.after(async () => {
    runtime.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });
  assert.deepEqual(await api.googleStatus(), {
    configured: false,
    connected: false,
    account: undefined,
    authorizing: false,
  });
  await assert.rejects(
    api.configureGoogle({ clientId: "invalid", clientSecret: "" }),
  );
  await api.configureGoogle({
    clientId: "test.apps.googleusercontent.com",
    clientSecret: "value",
  });
  assert.equal((await api.googleStatus()).configured, true);
  assert(!JSON.stringify(await api.googleStatus()).includes("value"));
  await api.connectGoogle();
  const auth = new URL(urls[0]),
    redirect = auth.searchParams.get("redirect_uri");
  assert.equal(auth.origin, "https://accounts.google.com");
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
  const wrong = await fetch(redirect + "?state=wrong");
  assert.equal(wrong.status, 400);
  assert.equal((await api.googleStatus()).connected, false);
  assert.throws(() => api.openGoogleItem("https://google.com.evil.test/mail"));
  await api.disconnectGoogle();
  assert.equal((await api.googleStatus()).authorizing, false);
});
test("연결 해제 뒤 늦게 도착한 인증 갱신으로 계정을 되살리지 않는다", async (t) => {
  const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "flowrium-google-refresh-"),
    ),
    api = {};
  let release, started;
  const begun = new Promise((resolve) => (started = resolve));
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (v) => Buffer.from("cipher:" + v),
    decryptString: (v) => v.toString().slice(7),
  };
  await fs.writeFile(
    path.join(dir, "google.enc"),
    storage.encryptString(
      JSON.stringify({
        clientId: "test.apps.googleusercontent.com",
        clientSecret: "value",
        refreshToken: "test-refresh",
        accessToken: "expired",
        expiresAt: 0,
      }),
    ),
  );
  const runtime = registerIntegrations(
    (n, f) => (api[n] = f),
    {},
    {
      directory: dir,
      secretStorage: storage,
      openExternal: async () => {},
      fetchImpl: async (url) => {
        if (url.endsWith("/token")) {
          started();
          return new Promise(
            (resolve) =>
              (release = () =>
                resolve(
                  Response.json({ access_token: "late", expires_in: 3600 }),
                )),
          );
        }
        return new Response("", { status: 200 });
      },
    },
  );
  t.after(async () => {
    runtime.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const pending = api.readGoogle({ kind: "calendar" });
  const rejected = assert.rejects(pending, /설정이 바뀌/);
  await begun;
  await api.disconnectGoogle();
  release();
  await rejected;
  assert.equal((await api.googleStatus()).connected, false);
});
