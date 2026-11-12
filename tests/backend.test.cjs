const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Store, settings } = require("../electron/store.cjs");
const { CodexClient, resolveCodex } = require("../electron/codex.cjs");
const { Controller } = require("../electron/controller.cjs");

const fakeDescriptor = {
  command: process.execPath,
  prefix: [path.join(__dirname, "backend-fake-codex.cjs")],
  label: "모의 Codex",
  node: true,
};
function eventOnce(controller, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      controller.removeListener("event", listener);
      reject(new Error("검증 이벤트 대기 시간이 초과됐습니다."));
    }, 5000);
    const listener = (event) => {
      if (predicate(event)) {
        clearTimeout(timeout);
        controller.removeListener("event", listener);
        resolve(event);
      }
    };
    controller.on("event", listener);
  });
}
async function fixture(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "flowrium-backend-"),
  );
  const projectPath = path.join(directory, "한글 & 공백 프로젝트");
  await fs.mkdir(projectPath);
  const store = new Store(path.join(directory, "기록"));
  await store.load();
  const project = await store.addProject(projectPath);
  const session = await store.createSession(project.id);
  const controller = new Controller(store, { descriptor: fakeDescriptor });
  t.after(async () => {
    await controller.shutdown();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { store, controller, project, session, directory };
}

test("작업 공간은 한글과 공백이 있는 실제 경로와 대화를 원자적으로 보존한다", async (t) => {
  const { store, project, session, directory } = await fixture(t);
  assert.equal(
    project.path,
    await fs.realpath(path.join(directory, "한글 & 공백 프로젝트")),
  );
  assert.equal((await store.addProject(project.path)).id, project.id);
  await store.saveSettings({ theme: "light", effort: "high" });
  const restored = new Store(path.join(directory, "기록"));
  await restored.load();
  assert.equal(restored.state.sessions[0].id, session.id);
  assert.equal(restored.state.settings.theme, "light");
  assert.deepEqual(
    (await fs.readdir(path.dirname(store.file))).filter((name) =>
      name.endsWith(".tmp"),
    ),
    [],
  );
  assert.throws(() => settings({ codexPath: "상대/경로" }), /절대 경로/);
  assert.throws(() => settings({ arbitrary: true }), /지원하지 않는 설정/);
});

test("손상된 작업 기록을 조용히 덮어쓰지 않는다", async (t) => {
  const { store, directory } = await fixture(t);
  await fs.writeFile(store.file, "{broken");
  const restored = new Store(path.join(directory, "기록"));
  await assert.rejects(restored.load(), /원본 파일은 보존/);
  assert.equal(await fs.readFile(store.file, "utf8"), "{broken");
});

test("초기화 후 계정과 모델을 조회하고 인증 정보를 노출하지 않는다", async (t) => {
  const { controller } = await fixture(t);
  const result = await controller.connect();
  assert.equal(result.status.authenticated, true);
  assert.equal(result.accountLabel, "ChatGPT / pro");
  assert.equal(result.models[0].id, "test-model");
  assert.equal(
    JSON.stringify(result).includes("개인정보를 출력하지 않음"),
    false,
  );
  assert.equal(
    (await controller.login()).authUrl.startsWith("https://auth.openai.com/"),
    true,
  );
});

test("읽기 전용 계획 작업은 스트리밍 후 최종 응답과 대화 식별자를 저장한다", async (t) => {
  const { store, controller, session } = await fixture(t);
  const deltas = [];
  controller.on("event", (event) => {
    if (event.type === "delta") deltas.push(event.text);
  });
  const done = eventOnce(controller, (event) => event.type === "done");
  assert.equal(
    (
      await controller.send({
        sessionId: session.id,
        text: "구조를 설명해 줘",
        mode: "plan",
      })
    ).accepted,
    true,
  );
  assert.equal((await done).status, "completed");
  const saved = store.session(session.id);
  assert.equal(saved.messages[0].text, "구조를 설명해 줘");
  assert.equal(saved.messages[1].text, "확인한 결과입니다. / readOnly");
  assert.equal(deltas.join(""), "확인한 결과입니다.");
  assert.match(saved.threadId, /^thread-/);
  const doneAgain = eventOnce(controller, (event) => event.type === "done");
  await controller.send({
    sessionId: session.id,
    text: "구현해 줘",
    mode: "build",
  });
  await doneAgain;
  assert.equal(
    saved.messages.at(-1).text,
    "확인한 결과입니다. / workspaceWrite",
  );
});

test("동시 대화 실행을 구분하고 같은 대화의 중복 전송과 삭제를 차단한다", async (t) => {
  const { store, controller, project, session } = await fixture(t);
  const second = await store.createSession(project.id);
  const firstDone = eventOnce(
    controller,
    (event) => event.type === "done" && event.sessionId === session.id,
  );
  const secondDone = eventOnce(
    controller,
    (event) => event.type === "done" && event.sessionId === second.id,
  );
  await controller.send({
    sessionId: session.id,
    text: "대기검증",
    mode: "plan",
  });
  await assert.rejects(
    controller.send({ sessionId: session.id, text: "중복", mode: "plan" }),
    /이미 실행 중/,
  );
  await assert.rejects(
    controller.deleteSession(session.id),
    /삭제할 수 없습니다/,
  );
  await controller.send({
    sessionId: second.id,
    text: "검토해 줘",
    mode: "review",
  });
  assert.equal((await secondDone).status, "completed");
  await controller.interrupt(session.id);
  assert.equal((await firstDone).status, "interrupted");
  assert.equal(store.session(session.id).messages.at(-1).role, "system");
});

test("명령 실행 승인은 명시적인 선택을 프로토콜에 전달한다", async (t) => {
  const { controller, session, store } = await fixture(t);
  const approval = eventOnce(controller, (event) => event.type === "approval");
  const done = eventOnce(controller, (event) => event.type === "done");
  await controller.send({
    sessionId: session.id,
    text: "승인검증",
    mode: "build",
  });
  const request = await approval;
  assert.match(request.details, /검증용 명령/);
  controller.client.decide(request.requestId, "decline");
  await done;
  assert.equal(
    store.session(session.id).messages.at(-1).text,
    "확인한 결과입니다. / decline",
  );
  assert.throws(
    () => controller.client.decide(request.requestId, "accept"),
    /이미 종료/,
  );
});

test("하위 프로세스 종료는 실행 잠금과 요청을 정리하고 실패를 기록한다", async (t) => {
  const { controller, session, store } = await fixture(t);
  const done = eventOnce(controller, (event) => event.type === "done");
  await controller.send({
    sessionId: session.id,
    text: "강제종료",
    mode: "plan",
  });
  assert.equal((await done).status, "failed");
  assert.equal(controller.runs.size, 0);
  assert.match(store.session(session.id).messages.at(-1).text, /연결이 종료/);
});

test("명령 문자열을 셸로 해석하지 않고 실행 파일을 찾는다", async () => {
  const found = await resolveCodex(process.execPath);
  assert.equal(found.command, process.execPath);
  assert.deepEqual(found.prefix, []);
  await assert.rejects(
    resolveCodex(path.join(os.tmpdir(), "flowrium-없는-실행파일")),
    /지정한 Codex 실행 파일/,
  );
  const client = new CodexClient({ descriptor: fakeDescriptor });
  await client.start();
  assert.equal(client.ready, true);
  client.close();
});

test("읽기 전용 작업은 하위 서버가 추가 실행 승인을 요청해도 거절한다", async (t) => {
  const { controller, session, store } = await fixture(t);
  let approvals = 0;
  controller.on("event", (event) => {
    if (event.type === "approval") approvals++;
  });
  const done = eventOnce(controller, (event) => event.type === "done");
  await controller.send({
    sessionId: session.id,
    text: "승인검증",
    mode: "review",
  });
  await done;
  assert.equal(approvals, 0);
  assert.equal(
    store.session(session.id).messages.at(-1).text,
    "확인한 결과입니다. / decline",
  );
});

test("전송 전 저장 실패는 메시지와 실행 잠금을 되돌려 중복 없는 재시도를 허용한다", async (t) => {
  const { controller, store, session } = await fixture(t);
  const originalSave = store.save.bind(store);
  const before = structuredClone(store.session(session.id));
  store.save = async () => {
    throw new Error("검증용 저장 실패");
  };
  await assert.rejects(
    controller.send({
      sessionId: session.id,
      text: "저장되지 않는 전송",
      mode: "plan",
    }),
    /저장 실패/,
  );
  assert.deepEqual(store.session(session.id), before);
  assert.equal(controller.runs.size, 0);
  store.save = originalSave;
  const done = eventOnce(controller, (event) => event.type === "done");
  await controller.send({
    sessionId: session.id,
    text: "정상 재시도",
    mode: "plan",
  });
  await done;
  assert.equal(
    store.session(session.id).messages.filter((item) => item.role === "user")
      .length,
    1,
  );
});

test("완료 시 저장 실패도 응답을 보존하고 완료 이벤트와 잠금 해제를 알린다", async (t) => {
  const { controller, store, session } = await fixture(t);
  const originalSave = store.save.bind(store);
  const started = eventOnce(
    controller,
    (event) =>
      event.type === "status" &&
      event.sessionId &&
      event.text === "Codex가 작업하고 있습니다.",
  );
  const done = eventOnce(controller, (event) => event.type === "done");
  await controller.send({
    sessionId: session.id,
    text: "완료 저장 검증",
    mode: "plan",
  });
  await started;
  store.save = async () => {
    throw new Error("검증용 저장 실패");
  };
  const result = await done;
  assert.match(result.text, /기록을 저장하지 못했습니다/);
  assert.equal(controller.runs.size, 0);
  assert.match(store.session(session.id).messages.at(-1).text, /확인한 결과/);
  store.save = originalSave;
  await store.save();
});

test("ChatGPT 로그인 없이 API 키 또는 인증 불필요 응답으로 작업을 시작하지 않는다", async (t) => {
  const { store, session } = await fixture(t);
  for (const flag of ["--api-account", "--no-account"]) {
    const controller = new Controller(store, {
      descriptor: {
        ...fakeDescriptor,
        prefix: [...fakeDescriptor.prefix, flag],
      },
    });
    t.after(() => controller.shutdown());
    assert.equal((await controller.connect()).status.authenticated, false);
    const done = eventOnce(controller, (event) => event.type === "done");
    await controller.send({
      sessionId: session.id,
      text: "ChatGPT 인증 검증",
      mode: "plan",
    });
    assert.equal((await done).status, "failed");
    assert.match(
      store.session(session.id).messages.at(-1).text,
      /ChatGPT 계정으로 로그인/,
    );
    await controller.shutdown();
  }
});

test("토큰 스트리밍은 파일을 만들지 않고 전송과 작업 완료 시에만 프로젝트 개정을 저장한다", async (t) => {
  const { store, controller, project, session } = await fixture(t);
  const history = path.join(project.path, ".flowrium", "sessions");
  const before = (await fs.readdir(history)).length;
  const done = eventOnce(controller, (event) => event.type === "done");
  await controller.send({
    sessionId: session.id,
    text: "저장 횟수 검증",
    mode: "plan",
  });
  await done;
  assert.equal((await fs.readdir(history)).length, before + 2);
});
