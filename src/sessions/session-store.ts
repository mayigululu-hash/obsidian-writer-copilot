import { normalizePath, type DataAdapter } from "obsidian";
import type { ChatMessage, ChatSession, ChatSessionSummary, ModelSource } from "../types";

export class SessionStore {
  constructor(private readonly adapter: DataAdapter, private readonly directory: string) {}

  async initialize(): Promise<void> {
    if (!(await this.adapter.exists(this.directory))) await this.adapter.mkdir(this.directory);
    const sessions = await this.listSessions();
    for (const summary of sessions) {
      if (summary.status !== "generating") continue;
      const session = await this.getSession(summary.id);
      session.status = "stopped";
      for (const message of session.messages) if (message.status === "generating") message.status = "stopped";
      await this.save(session);
    }
  }

  async createSession(title = "新对话", modelID?: string, agentID?: string, modelSource: ModelSource = "agent"): Promise<ChatSessionSummary> {
    const now = Date.now();
    const session: ChatSession = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      title,
      modelID,
      agentID,
      modelSource,
      createdAt: now,
      updatedAt: now,
      status: "idle",
      messages: []
    };
    await this.save(session);
    return summary(session);
  }

  async getSession(id: string): Promise<ChatSession> {
    const raw = await this.adapter.read(this.path(id));
    const value = JSON.parse(raw) as ChatSession;
    if (value.schemaVersion !== 1 || value.id !== id || !Array.isArray(value.messages)) throw new Error("会话文件已损坏");
    return value;
  }

  async getMessages(id: string): Promise<ChatMessage[]> {
    return (await this.getSession(id)).messages;
  }

  async listSessions(): Promise<ChatSessionSummary[]> {
    if (!(await this.adapter.exists(this.directory))) return [];
    const listed = await this.adapter.list(this.directory);
    const sessions: ChatSessionSummary[] = [];
    for (const path of listed.files.filter((file) => file.endsWith(".json"))) {
      try { sessions.push(summary(JSON.parse(await this.adapter.read(path)) as ChatSession)); } catch { /* Ignore damaged files in history list. */ }
    }
    return sessions.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async appendMessage(sessionID: string, message: Omit<ChatMessage, "sessionID">): Promise<ChatSession> {
    const session = await this.getSession(sessionID);
    session.messages.push({ ...message, sessionID });
    if (message.status === "generating") session.status = "generating";
    session.updatedAt = Date.now();
    await this.save(session);
    return session;
  }

  async updateAssistant(sessionID: string, messageID: string, text: string, status: ChatMessage["status"], error?: string): Promise<void> {
    const session = await this.getSession(sessionID);
    const message = session.messages.find((item) => item.id === messageID);
    if (!message) throw new Error("生成中的消息已不存在");
    message.text = text;
    message.status = status;
    message.error = error;
    session.status = status === "generating" ? "generating" : status === "error" ? "error" : status === "stopped" ? "stopped" : "idle";
    session.updatedAt = Date.now();
    if (session.title === "新对话") {
      const firstUser = session.messages.find((item) => item.role === "user")?.text.trim();
      if (firstUser) session.title = firstUser.replace(/\s+/g, " ").slice(0, 28);
    }
    await this.save(session);
  }

  async setModel(sessionID: string, modelID: string | undefined, modelSource: ModelSource = "manual"): Promise<void> {
    const session = await this.getSession(sessionID);
    session.modelID = modelID;
    session.modelSource = modelSource;
    session.updatedAt = Date.now();
    await this.save(session);
  }

  async setAgent(sessionID: string, agentID: string | undefined, modelID: string | undefined): Promise<void> {
    const session = await this.getSession(sessionID);
    session.agentID = agentID;
    session.modelID = modelID;
    session.modelSource = "agent";
    session.updatedAt = Date.now();
    await this.save(session);
  }

  async renameSession(sessionID: string, title: string): Promise<void> {
    const session = await this.getSession(sessionID);
    session.title = title.trim();
    session.updatedAt = Date.now();
    await this.save(session);
  }

  async deleteSession(sessionID: string): Promise<void> {
    const path = this.path(sessionID);
    if (await this.adapter.exists(path)) await this.adapter.remove(path);
  }

  async clearSessions(): Promise<void> {
    if (!(await this.adapter.exists(this.directory))) return;
    const listed = await this.adapter.list(this.directory);
    for (const path of listed.files.filter((file) => file.endsWith(".json"))) await this.adapter.remove(path);
  }

  private async save(session: ChatSession): Promise<void> {
    const path = this.path(session.id);
    const data = `${JSON.stringify(session, null, 2)}\n`;
    if (await this.adapter.exists(path)) {
      await this.adapter.process(path, () => data);
      return;
    }
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await this.adapter.write(temporary, data);
    await this.adapter.rename(temporary, path);
  }

  private path(id: string): string {
    return normalizePath(`${this.directory}/${id}.json`);
  }
}

function summary(session: ChatSession): ChatSessionSummary {
  return {
    id: session.id,
    title: session.title || "未命名会话",
    modelID: session.modelID,
    agentID: session.agentID,
    modelSource: session.modelSource,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    status: session.status
  };
}
