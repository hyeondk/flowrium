const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { Store } = require("../electron/store.cjs");
const { HistoryImporter } = require("../electron/history.cjs");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "flowrium-history-"));
  const directory = path.join(root, "선택한 프로젝트");
  await fs.mkdir(directory);
  const store = new Store(path.join(root, "설정"));
  await store.load();
  const project = await store.addProject(directory);
  t.after(async () => {
    await store.queue.catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  });
  const calls = [];
  let starts = 0;
  const thread = (id) => ({
    id,
    cwd: project.path,
    name: `대화 ${id}`,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_100,
    ephemeral: false,
  });
  const client = {
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === "thread/list") {
        assert.equal(params.cwd, project.path);
        assert.equal(params.useStateDbOnly, true);
        if (params.archived)
          return { data: [thread("보관된대화")], nextCursor: null };
        if (!params.cursor)
          return {
            data: [
              thread("첫대화"),
              {
                ...thread("다른프로젝트"),
                cwd: path.join(root, "다른프로젝트"),
              },
            ],
            nextCursor: "목록의다음페이지",
          };
        assert.equal(params.cursor, "목록의다음페이지");
        return { data: [thread("두번째대화")], nextCursor: null };
      }
      if (method === "thread/read") return { thread: thread(params.threadId) };
      if (method === "thread/turns/list") {
        assert.equal(params.itemsView, "full");
        assert.equal(params.sortDirection, "asc");
        if (!params.cursor)
          return {
            data: [
              {
                id: "첫작업",
                itemsView: "full",
                startedAt: 1_700_000_000,
                items: [
                  {
                    id: "첫질문",
                    type: "userMessage",
                    content: [
                      { type: "text", text: "저장할 사용자 본문" },
                      { type: "localImage", path: "복사하지않을첨부.png" },
                    ],
                  },
                  {
                    id: "명령",
                    type: "commandExecution",
                    aggregatedOutput: "복사하지않을도구출력",
                  },
                  {
                    id: "답변",
                    type: "agentMessage",
                    text: "저장할 답변 본문",
                  },
                ],
              },
            ],
            nextCursor: "작업의다음페이지",
          };
        return {
          data: [
            {
              id: "두번째작업",
              itemsView: "summary",
              startedAt: 1_700_000_001,
              items: [],
            },
          ],
          nextCursor: null,
        };
      }
      if (method === "thread/items/list") {
        if (!params.cursor)
          return {
            data: [
              {
                item: {
                  id: "추가질문",
                  type: "userMessage",
                  content: [{ type: "text", text: "다음 페이지의 질문" }],
                },
              },
            ],
            nextCursor: "항목의다음페이지",
          };
        return {
          data: [
            {
              item: {
                id: "추가답변",
                type: "agentMessage",
                text: "다음 페이지의 답변",
              },
            },
          ],
          nextCursor: null,
        };
      }
      throw new Error(`읽기 이외의 호출 금지: ${method}`);
    },
  };
  const history = new HistoryImporter(store, client, async () => {
    starts++;
  });
  return {
    root,
    directory,
    store,
    project,
    history,
    client,
    calls,
    getStarts: () => starts,
  };
}

test("명시적 목록 요청만 선택 프로젝트의 활성/보관 대화를 끝 페이지까지 읽는다", async (t) => {
  const { history, project, calls, getStarts } = await fixture(t);
  assert.equal(calls.length, 0);
  assert.equal(getStarts(), 0);
  const entries = await history.list(project.id);
  assert.deepEqual(
    new Set(entries.map((item) => item.id)),
    new Set(["첫대화", "두번째대화", "보관된대화"]),
  );
  assert.equal(
    entries.every((entry) => entry.imported === false),
    true,
  );
  assert.equal(calls.filter((call) => call.method === "thread/list").length, 3);
  assert.equal(
    calls.some((call) => call.method === "thread/read"),
    false,
  );
});

test("선택한 대화의 모든 작업/항목 페이지에서 사용자와 답변 본문만 프로젝트에 저장한다", async (t) => {
  const { history, store, project, directory, calls } = await fixture(t);
  assert.deepEqual(await history.import(project.id, ["첫대화"]), {
    imported: 1,
    skipped: 0,
  });
  const session = store.state.sessions[0];
  assert.equal(session.sourceThreadId, "첫대화");
  assert.equal(session.threadId, undefined);
  assert.deepEqual(
    session.messages.map((item) => item.text),
    [
      "저장할 사용자 본문",
      "저장할 답변 본문",
      "다음 페이지의 질문",
      "다음 페이지의 답변",
    ],
  );
  assert.equal(
    calls.filter((call) => call.method === "thread/turns/list").length,
    2,
  );
  assert.equal(
    calls.filter((call) => call.method === "thread/items/list").length,
    2,
  );
  assert.equal(
    (await fs.readFile(store.file, "utf8")).includes("저장할 사용자 본문"),
    false,
  );
  const restored = new Store(path.join(directory, "다른컴퓨터설정"));
  await restored.load();
  await restored.addProject(directory);
  assert.equal(restored.state.sessions[0].sourceThreadId, "첫대화");
  const otherHistory = new HistoryImporter(
    restored,
    history.client,
    async () => {},
  );
  assert.deepEqual(await otherHistory.import(project.id, ["첫대화"]), {
    imported: 0,
    skipped: 1,
  });
});

test("선택 중복과 재시도는 대화를 중복 저장하지 않고 같은 프로젝트 동시 호출을 차단한다", async (t) => {
  const { history, store, project } = await fixture(t);
  const first = history.import(project.id, ["첫대화", "첫대화"]);
  await assert.rejects(
    history.import(project.id, ["두번째대화"]),
    /이미 가져오고 있습니다/,
  );
  assert.deepEqual(await first, { imported: 1, skipped: 1 });
  assert.deepEqual(await history.import(project.id, ["첫대화"]), {
    imported: 0,
    skipped: 1,
  });
  assert.equal(store.state.sessions.length, 1);
});

test("다른 프로젝트 식별자는 본문을 읽기 전에 차단하고 원본 대화를 실행하거나 수정하지 않는다", async (t) => {
  const { history, project, calls, store } = await fixture(t);
  await assert.rejects(
    history.import(project.id, ["다른프로젝트"]),
    /프로젝트에 속하지 않/,
  );
  assert.equal(
    calls.some((call) => call.method === "thread/read"),
    false,
  );
  assert.equal(store.state.sessions.length, 0);
  assert.equal(
    calls.every((call) => call.method === "thread/list"),
    true,
  );
});

test("페이지가 반복되거나 본문 오류가 나면 부분 대화를 저장하지 않는다", async (t) => {
  const { history, client, project, store } = await fixture(t);
  const original = client.request;
  client.request = async (method, params) =>
    method === "thread/list"
      ? { data: [], nextCursor: "반복" }
      : original(method, params);
  await assert.rejects(history.list(project.id), /페이지가 반복/);
  client.request = async (method, params) =>
    method === "thread/turns/list"
      ? Promise.reject(new Error("검증용 본문 읽기 실패"))
      : original(method, params);
  await assert.rejects(
    history.import(project.id, ["첫대화"]),
    /본문 읽기 실패/,
  );
  assert.equal(store.state.sessions.length, 0);
});

test("페이지 API가 없는 구버전만 읽기 전용 전체 본문 조회로 보완한다", async (t) => {
  const { history, client, project, store } = await fixture(t);
  const original = client.request;
  client.request = async (method, params) => {
    if (method === "thread/turns/list") {
      const error = new Error("지원되지 않는 방식");
      error.rpcCode = -32601;
      throw error;
    }
    const response = await original(method, params);
    if (method === "thread/read" && params.includeTurns)
      response.thread.turns = [
        {
          id: "구버전작업",
          items: [
            { type: "agentMessage", id: "구버전답변", text: "구버전 본문" },
          ],
        },
      ];
    return response;
  };
  assert.deepEqual(await history.import(project.id, ["첫대화"]), {
    imported: 1,
    skipped: 0,
  });
  assert.equal(store.state.sessions[0].messages[0].text, "구버전 본문");
});
