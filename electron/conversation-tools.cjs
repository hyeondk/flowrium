const { randomUUID } = require("node:crypto");
const { text } = require("./store.cjs");

function registerConversationTools(register, controller) {
  const { store } = controller;
  const editing = controller.editingSessions;
  register("editConversation", async (id, input) => {
    const session = store.session(text(id, "대화 식별자", 100));
    if (controller.runs.has(id) || editing.has(id))
      throw new Error("대화 작업이 끝난 뒤 다시 시도해 주세요.");
    editing.add(id);
    try {
      if (input?.action === "compact") {
        if (!session.threadId) throw new Error("이 기기에서 대화를 한 번 실행한 뒤 문맥을 압축할 수 있습니다.");
        await controller.client.start(store.state.settings.codexPath);
        if (!controller.loadedThreads.has(session.threadId)) {
          await controller.client.request("thread/resume", { threadId: session.threadId, cwd: store.project(session.projectId).path });
          controller.loadedThreads.add(session.threadId);
        }
        await controller.client.request("thread/compact/start", { threadId: session.threadId });
        return structuredClone(session);
      }
      const old = structuredClone(session);
      const index = session.messages.findIndex(message => message.id === input?.messageId);
      if (input?.action === "branch") {
        if (input.messageId && index < 0) throw new Error("분기할 메시지를 찾을 수 없습니다.");
        const workflow = session.workflow && { ...structuredClone(session.workflow), status: "active" };
        if (workflow) delete workflow.completion;
        return store.createSession(session.projectId, {
          title: ("분기 / " + session.title).slice(0, 300), workflow,
          messages: session.messages.slice(0, input.messageId ? index + 1 : undefined).map(message => ({ ...message, id: randomUUID() })),
        });
      }
      if (input?.action === "preferences") {
        session.preferences = require("./chat-preferences.cjs").preferences(input.preferences);
      } else if (input?.action === "rename") {
        session.title = text(input.title, "대화 이름", 300);
      } else if (input?.action === "rewind" && index >= 0 && session.messages[index].role === "user") {
        // 이후 대화의 Codex 문맥이 다시 섞이지 않도록 다음 요청은 남긴 기록으로 시작한다.
        session.messages = session.messages.slice(0, index);
        delete session.threadId;
        if (session.workflow) {
          session.workflow.status = "active";
          delete session.workflow.completion;
        }
      } else throw new Error("대화 편집 요청을 확인해 주세요.");
      session.updatedAt = new Date().toISOString();
      try { await store.save(); }
      catch (error) {
        for (const key of Object.keys(session)) delete session[key];
        Object.assign(session, old);
        throw error;
      }
      return structuredClone(session);
    } finally { editing.delete(id); }
  });
}
module.exports = { registerConversationTools };
