const fs = require("node:fs/promises"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
function registerVoice(
  register,
  { directory, secretStorage, allowCapture, fetchImpl = fetch },
) {
  const file = path.join(directory, "voice.enc");
  let queue = Promise.resolve();
  async function read() {
    try {
      return secretStorage.decryptString(await fs.readFile(file));
    } catch (e) {
      if (e.code === "ENOENT") return "";
      throw Error("음성 인증 설정을 열지 못했습니다.");
    }
  }
  register("voiceStatus", async () => ({ configured: !!(await read()) }));
  register("configureVoice", async (key) => {
    if (
      key !== null &&
      (typeof key !== "string" || !/^sk-[A-Za-z0-9_-]{15,300}$/.test(key))
    )
      throw Error("OpenAI API 키를 확인해 주세요.");
    const save = queue
      .catch(() => {})
      .then(async () => {
        if (key === null) {
          await fs.rm(file, { force: true });
          return;
        }
        if (!secretStorage.isEncryptionAvailable())
          throw Error("운영체제의 보안 저장소를 사용할 수 없습니다.");
        await fs.mkdir(directory, { recursive: true });
        const tmp = file + "." + randomUUID() + ".tmp";
        try {
          await fs.writeFile(tmp, secretStorage.encryptString(key), {
            mode: 0o600,
          });
          await fs.rename(tmp, file);
        } finally {
          await fs.rm(tmp, { force: true });
        }
      });
    queue = save;
    await save;
  });
  register("allowVoiceCapture", allowCapture);
  register("transcribeVoice", async (input) => {
    if (
      !input ||
      typeof input.base64 !== "string" ||
      input.base64.length > 26 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64) ||
      ![
        "audio/webm",
        "audio/wav",
        "audio/mpeg",
        "audio/mp4",
        "audio/x-m4a",
      ].includes(input.mime)
    )
      throw Error("지원하는 음성 파일과 크기를 확인해 주세요.");
    const buffer = Buffer.from(input.base64, "base64");
    if (!buffer.length || buffer.length > 19 * 1024 * 1024)
      throw Error("음성 파일은 19MB까지 사용할 수 있습니다.");
    const key = await read();
    if (!key)
      throw Error("음성 입력 설정에 본인의 OpenAI API 키를 등록해 주세요.");
    const ext = {
        "audio/webm": "webm",
        "audio/wav": "wav",
        "audio/mpeg": "mp3",
        "audio/mp4": "mp4",
        "audio/x-m4a": "m4a",
      }[input.mime],
      form = new FormData();
    form.append("model", "gpt-transcribe");
    form.append(
      "file",
      new Blob([buffer], { type: input.mime }),
      "recording." + ext,
    );
    form.append("response_format", "json");
    const response = await fetchImpl(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + key },
        body: form,
        signal: AbortSignal.timeout(120000),
      },
    );
    if (!response.ok)
      throw Error(
        "음성 인식을 마치지 못했습니다. API 키, 잔액과 연결을 확인해 주세요. (" +
          response.status +
          ")",
      );
    const value = await response.json();
    if (typeof value.text !== "string" || value.text.length > 200000)
      throw Error("음성 인식 결과를 확인하지 못했습니다.");
    return value.text;
  });
}
module.exports = { registerVoice };
