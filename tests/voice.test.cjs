const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { registerVoice } = require("../electron/voice.cjs");
test("음성 인증은 기기에 암호화 보관하고 직접 보낸 오디오만 전사한다", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "flowrium-voice-")),
    api = {};
  let request;
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  registerVoice((n, f) => (api[n] = f), {
    directory: dir,
    secretStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (v) => Buffer.from("cipher:" + v),
      decryptString: (v) => v.toString().slice(7),
    },
    allowCapture: async () => false,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return Response.json({ text: "검증한 음성 문장" });
    },
  });
  assert.equal((await api.voiceStatus()).configured, false);
  await assert.rejects(
    api.transcribeVoice({ base64: "YWJj", mime: "audio/webm" }),
    /API/,
  );
  await api.configureVoice("sk-test12345678901234567890");
  assert.deepEqual(await api.voiceStatus(), { configured: true });
  assert.equal(await api.allowVoiceCapture(), false);
  const result = await api.transcribeVoice({
    base64: "YWJj",
    mime: "audio/webm",
  });
  assert.equal(result, "검증한 음성 문장");
  assert.equal(request.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(request.options.body.get("model"), "gpt-4o-mini-transcribe");
  assert.equal(request.options.body.get("file").size, 3);
  await assert.rejects(
    api.transcribeVoice({ base64: "YWJj", mime: "text/plain" }),
  );
  await api.configureVoice(null);
  assert.equal((await api.voiceStatus()).configured, false);
});
