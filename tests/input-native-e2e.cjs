// 실제 번들 app-server와 이 컴퓨터의 모의 Responses 서버만 사용한다.
const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  http = require("node:http"),
  os = require("node:os"),
  path = require("node:path"),
  { spawn } = require("node:child_process");
const { CodexClient, resolveCodex } = require("../electron/codex.cjs");
async function main() {
  const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "flowrium-question-native-"),
    ),
    folder = path.join(directory, "project");
  let client,
    server,
    failure,
    replied = false,
    offered = false,
    calls = 0,
    phase = "";
  const questions = [
    {
      id: "format",
      header: "서식",
      question: "형식을 골라 주세요.",
      options: [{ label: "요약", description: "핵심" }],
      isOther: true,
    },
  ];
  try {
    await fs.mkdir(folder);
    server = http.createServer(async (req, res) => {
      try {
        if (req.method !== "POST" || !req.url.startsWith("/v1/responses")) {
          res.writeHead(404).end();
          return;
        }
        const parts = [];
        for await (const chunk of req) parts.push(chunk);
        const body = JSON.parse(Buffer.concat(parts).toString("utf8"));
        calls++;
        const namespace = body.tools.find(
          (t) =>
            t.type === "namespace" &&
            t.tools?.some((v) => v.name === "request_user_input"),
        );
        offered ||= Boolean(
          namespace || body.tools.some((t) => t.name === "request_user_input"),
        );
        const responseId = "resp_test_" + calls,
          itemId = "test_item_" + calls;
        const fn = {
          type: "function_call",
          id: itemId,
          call_id: "call_user_input",
          name: "request_user_input",
          ...(namespace && { namespace: namespace.name }),
          arguments: JSON.stringify({ questions }),
        };
        if (calls > 1)
          replied ||= (body.input || []).some(
            (item) =>
              item.type === "function_call_output" &&
              JSON.stringify(item.output).includes("직접 고른 형식"),
          );
        const item =
          calls === 1
            ? fn
            : {
                id: itemId,
                type: "message",
                role: "assistant",
                status: "completed",
                content: [
                  {
                    type: "output_text",
                    text: "응답을 받았습니다.",
                    annotations: [],
                  },
                ],
              };
        const stream = [
          {
            type: "response.created",
            response: { id: responseId, status: "in_progress" },
          },
          {
            type: "response.output_item.added",
            output_index: 0,
            item: {
              ...item,
              ...(calls === 1 ? { arguments: "" } : { content: [] }),
            },
          },
          { type: "response.output_item.done", output_index: 0, item },
          {
            type: "response.completed",
            response: {
              id: responseId,
              status: "completed",
              output: [item],
              usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 },
            },
          },
        ];
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        res.end(
          stream.map((e) => "data: " + JSON.stringify(e) + "\n\n").join(""),
        );
      } catch (e) {
        failure = e;
        res.writeHead(500).end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = "http://127.0.0.1:" + server.address().port + "/v1";
    const profile = path.join(directory, "codex");
    await fs.mkdir(profile);
    await fs.writeFile(
      path.join(profile, "config.toml"),
      [
        'cli_auth_credentials_store = "file"',
        'model = "gpt-5.5"',
        "[model_providers.flowrium_test]",
        'name = "Flowrium local test"',
        "base_url = " + JSON.stringify(address),
        'wire_api = "responses"',
        'env_key = "FLOWRIUM_OFFLINE_KEY"',
        "supports_websockets = false",
        "[analytics]",
        "enabled = false",
        "",
      ].join("\n"),
    );
    const descriptor = await resolveCodex();
    assert(descriptor, "Codex 번들을 찾지 못했습니다.");
    client = new CodexClient({
      descriptor,
      spawn: (cmd, args, opts) => {
        const env = {
          ...opts.env,
          CODEX_HOME: profile,
          FLOWRIUM_OFFLINE_KEY: "synthetic-local-value",
          OPENAI_BASE_URL: address,
        };
        return spawn(cmd, [...args, "-c", 'model_provider="flowrium_test"'], {
          ...opts,
          env,
        });
      },
    });
    let end, failed;
    const completed = new Promise((resolve, reject) => {
      end = resolve;
      failed = reject;
    });
    client.on("notification", (msg) => {
      phase = msg.method;
      if (msg.method === "turn/completed") end(msg.params.turn);
    });
    client.on("input", ({ requestId, params }) => {
      try {
        assert.equal(params.questions[0].id, "format");
        client.answerInput(requestId, {
          format: { answers: ["직접 고른 형식"] },
        });
      } catch (e) {
        failed(e);
      }
    });
    await client.start();
    const result = await client.request("thread/start", {
      model: "gpt-5.5",
      modelProvider: "flowrium_test",
      cwd: folder,
      sandbox: "read-only",
      approvalPolicy: "never",
    });
    await client.request("turn/start", {
      threadId: result.thread.id,
      input: [{ type: "text", text: "모의 질문을 테스트합니다." }],
    });
    const timeout = setTimeout(
      () =>
        failed(
          new Error(
            "실제 질문 응답 대기 시간 초과: 호출 " +
              calls +
              " / 제공 " +
              offered +
              " / " +
              phase,
          ),
        ),
      15000,
    );
    timeout.unref();
    const turn = await completed.finally(() => clearTimeout(timeout));
    if (failure) throw failure;
    assert.equal(turn.status, "completed", turn.error?.message);
    assert(offered, "실제 모델 도구 목록에 사용자 입력 질문이 없습니다.");
    assert(replied, "두 번째 모델 요청에 사용자가 고른 답이 없습니다.");
    console.log(
      "번들 Codex의 실제 사용자 입력 도구 통과 / 로컬 모의 모델의 질문 / 기본 모드 허용 / app-server 왕복과 후속 턴",
    );
  } finally {
    client?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 200,
    });
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
