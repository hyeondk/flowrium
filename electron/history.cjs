const { samePath: sameFilesystemPath } = require('./path-boundary.cjs');
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { createHash } = require("node:crypto");
const { validateSession } = require("./project-store.cjs");

const SOURCES = [
  "cli",
  "vscode",
  "exec",
  "appServer",
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
  "unknown",
];
function samePath(value, expected) {
  if (typeof value !== "string") return false;
  try {
    const decoded = value.startsWith("file:") ? fileURLToPath(value) : value;
    if (!path.isAbsolute(decoded)) return false;
    const actual = path.resolve(decoded);
    const wanted = path.resolve(expected);
    return process.platform === "win32"
      ? actual.toLowerCase() === wanted.toLowerCase()
      : sameFilesystemPath(actual, wanted);
  } catch {
    return false;
  }
}
function timestamp(value, fallback) {
  const number =
    typeof value === "number"
      ? value * (Math.abs(value) < 1e12 ? 1000 : 1)
      : Date.parse(value);
  const date = new Date(number);
  return Number.isFinite(date.getTime())
    ? date.toISOString()
    : fallback || new Date().toISOString();
}
function stableId(value) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function unsupported(error) {
  return (
    error.rpcCode === -32601 ||
    /(?:does not support|unsupported).*(?:pagination|method)/i.test(
      error.rpcMessage || "",
    )
  );
}
async function pages(client, method, params) {
  const all = [];
  const cursors = new Set();
  let cursor;
  do {
    const result = await client.request(method, {
      ...params,
      ...(cursor ? { cursor } : {}),
    });
    if (!Array.isArray(result.data))
      throw new Error(
        "대화 목록 응답 형식이 올바르지 않습니다. 원본은 변경하지 않았습니다.",
      );
    all.push(...result.data);
    const next = result.nextCursor;
    if (next != null && typeof next !== "string")
      throw new Error("대화 목록의 다음 페이지 정보가 올바르지 않습니다.");
    if (next && cursors.has(next))
      throw new Error(
        "대화 목록의 페이지가 반복돼 가져오기를 중단했습니다. 원본은 변경하지 않았습니다.",
      );
    if (next) cursors.add(next);
    cursor = next;
  } while (cursor);
  return all;
}

class HistoryImporter {
  constructor(store, client, start) {
    this.store = store;
    this.client = client;
    this.start = start;
    this.pending = new Map();
  }
  isImported(projectId, id) {
    return this.store.state.sessions.some(
      (session) =>
        session.projectId === projectId &&
        (session.sourceThreadId === id || session.threadId === id),
    );
  }
  async list(projectId) {
    const project = this.store.project(projectId);
    if(project.conversationScope)throw Error('Codex 기록 가져오기는 프로젝트 대화에서 사용해 주세요.');
    await this.start();
    const result = new Map();
    for (const archived of [false, true]) {
      const threads = await pages(this.client, "thread/list", {
        cwd: project.path,
        archived,
        limit: 100,
        sortKey: "updated_at",
        sortDirection: "desc",
        sourceKinds: SOURCES,
        modelProviders: ["openai"],
        useStateDbOnly: true,
      });
      for (const thread of threads) {
        // Validate the server filter again before showing even thread metadata.
        if (
          !samePath(thread.cwd, project.path) ||
          thread.ephemeral ||
          typeof thread.id !== "string" ||
          !thread.id ||
          thread.id.length > 300
        )
          continue;
        result.set(thread.id, {
          id: thread.id,
          title: (thread.name || thread.preview || "제목 없는 대화").slice(
            0,
            300,
          ),
          updatedAt: timestamp(thread.updatedAt),
          imported: this.isImported(projectId, thread.id),
        });
      }
    }
    return [...result.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }
  async readMessages(thread) {
    let turns;
    try {
      turns = await pages(this.client, "thread/turns/list", {
        threadId: thread.id,
        limit: 100,
        sortDirection: "asc",
        itemsView: "full",
      });
    } catch (error) {
      if (!unsupported(error)) throw error;
      const legacy = await this.client.request("thread/read", {
        threadId: thread.id,
        includeTurns: true,
      });
      if (
        !legacy.thread ||
        legacy.thread.id !== thread.id ||
        !samePath(legacy.thread.cwd, thread.cwd) ||
        !Array.isArray(legacy.thread.turns)
      )
        throw new Error(
          "이 대화의 본문을 안전하게 읽을 수 없습니다. 원본은 변경하지 않았습니다.",
        );
      turns = legacy.thread.turns;
    }
    const messages = [];
    const seenItems = new Set();
    for (const turn of turns) {
      let entries;
      if (turn.itemsView && turn.itemsView !== "full")
        entries = await pages(this.client, "thread/items/list", {
          threadId: thread.id,
          turnId: turn.id,
          limit: 100,
          sortDirection: "asc",
        });
      else {
        if (!Array.isArray(turn.items))
          throw new Error(
            "대화 본문 형식을 확인할 수 없어 가져오기를 중단했습니다.",
          );
        entries = turn.items.map((item) => ({ item }));
      }
      for (const [index, entry] of entries.entries()) {
        const item = entry.item;
        if (!item || typeof item !== "object") continue;
        let role;
        let body;
        if (item.type === "userMessage") {
          role = "user";
          body = Array.isArray(item.content)
            ? item.content
                .filter(
                  (part) =>
                    part.type === "text" && typeof part.text === "string",
                )
                .map((part) => part.text)
                .join("\n")
            : "";
        } else if (item.type === "agentMessage" || item.type === "plan") {
          role = "assistant";
          body = typeof item.text === "string" ? item.text : "";
        } else if (item.type === "exitedReviewMode") {
          role = "assistant";
          body = typeof item.review === "string" ? item.review : "";
        } else continue;
        if (!body.trim()) continue;
        if (body.length > 2_000_000)
          throw new Error(
            "가져올 메시지가 허용 크기를 초과했습니다. 원본은 변경하지 않았습니다.",
          );
        const key = `${turn.id}:${item.id || index}:${role}`;
        if (seenItems.has(key)) continue;
        seenItems.add(key);
        const at =
          role === "user"
            ? (entry.startedAtMs ?? turn.startedAt)
            : (entry.completedAtMs ?? turn.completedAt ?? turn.startedAt);
        messages.push({
          id: stableId(`${thread.id}:${key}`),
          role,
          text: body,
          createdAt: timestamp(at, timestamp(thread.createdAt)),
        });
      }
    }
    return messages;
  }
  import(projectId, ids) {
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.some((id) => typeof id !== "string" || !id || id.length > 300)
    )
      return Promise.reject(
        new Error("가져올 대화를 한 개 이상 선택해 주세요."),
      );
    if (this.pending.has(projectId))
      return Promise.reject(
        new Error(
          "이 프로젝트의 대화를 이미 가져오고 있습니다. 잠시 기다려 주세요.",
        ),
      );
    const operation = this._import(projectId, ids).finally(() =>
      this.pending.delete(projectId),
    );
    this.pending.set(projectId, operation);
    return operation;
  }
  async _import(projectId, ids) {
    const project = this.store.project(projectId);
    if(project.conversationScope)throw Error('Codex 기록 가져오기는 프로젝트 대화에서 사용해 주세요.');
    const unique = [...new Set(ids)];
    const listed = new Map(
      (await this.list(projectId)).map((entry) => [entry.id, entry]),
    );
    if (unique.some((id) => !listed.has(id)))
      throw new Error(
        "선택한 프로젝트에 속하지 않거나 더 이상 사용할 수 없는 대화가 있습니다. 목록을 다시 확인해 주세요.",
      );
    let imported = 0;
    let skipped = ids.length - unique.length;
    for (const id of unique) {
      if (this.isImported(projectId, id)) {
        skipped++;
        continue;
      }
      const result = await this.client.request("thread/read", {
        threadId: id,
        includeTurns: false,
      });
      const thread = result.thread;
      if (!thread || thread.id !== id || !samePath(thread.cwd, project.path))
        throw new Error(
          "대화의 프로젝트 경로가 바뀌어 가져오기를 중단했습니다. 원본은 변경하지 않았습니다.",
        );
      const messages = await this.readMessages(thread);
      if (!messages.length) {
        skipped++;
        continue;
      }
      const session = {
        id: stableId(`flowrium:codex:${projectId}:${id}`),
        projectId,
        sourceThreadId: id,
        title: listed.get(id).title,
        messages,
        createdAt: timestamp(thread.createdAt),
        updatedAt: timestamp(thread.updatedAt),
      };
      validateSession(session, projectId);
      if (this.store.state.sessions.some((item) => item.id === session.id)) {
        skipped++;
        continue;
      }
      this.store.state.sessions.unshift(session);
      try {
        await this.store.save();
      } catch (error) {
        this.store.state.sessions = this.store.state.sessions.filter(
          (item) => item !== session,
        );
        throw error;
      }
      imported++;
    }
    return { imported, skipped };
  }
}
module.exports = { HistoryImporter, pages, samePath };
