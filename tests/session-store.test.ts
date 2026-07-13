import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ normalizePath: (value: string) => value.replace(/\/{2,}/g, "/") }));

import type { DataAdapter } from "obsidian";
import { SessionStore } from "../src/sessions/session-store";

describe("SessionStore", () => {
  it("persists, renames and deletes native sessions", async () => {
    const adapter = memoryAdapter();
    const store = new SessionStore(adapter, ".obsidian/plugins/writer-copilot/sessions");
    await store.initialize();
    const created = await store.createSession("新对话", "model-a", "agent-a", "agent");
    await store.appendMessage(created.id, { id: "u1", role: "user", text: "帮我改写", createdAt: 1, status: "complete" });
    await store.appendMessage(created.id, { id: "a1", role: "assistant", text: "", createdAt: 2, status: "generating" });
    await store.updateAssistant(created.id, "a1", "已改写", "complete");
    const session = await store.getSession(created.id);
    expect(session.title).toBe("帮我改写");
    expect(session.status).toBe("idle");
    expect(session.messages[1].text).toBe("已改写");
    expect(session.agentID).toBe("agent-a");
    await store.setModel(created.id, "model-b", "manual");
    expect((await store.getSession(created.id)).modelSource).toBe("manual");
    await store.setAgent(created.id, "agent-b", "model-c");
    expect(await store.getSession(created.id)).toMatchObject({ agentID: "agent-b", modelID: "model-c", modelSource: "agent" });
    await store.renameSession(created.id, "新标题");
    expect((await store.listSessions())[0].title).toBe("新标题");
    await store.deleteSession(created.id);
    expect(await store.listSessions()).toEqual([]);
  });

  it("recovers an interrupted generation as stopped on startup", async () => {
    const adapter = memoryAdapter();
    const first = new SessionStore(adapter, "sessions");
    await first.initialize();
    const created = await first.createSession();
    await first.appendMessage(created.id, { id: "a1", role: "assistant", text: "部分", createdAt: 1, status: "generating" });
    const restarted = new SessionStore(adapter, "sessions");
    await restarted.initialize();
    const recovered = await restarted.getSession(created.id);
    expect(recovered.status).toBe("stopped");
    expect(recovered.messages[0].status).toBe("stopped");
  });

  it("clears every local session", async () => {
    const adapter = memoryAdapter();
    const store = new SessionStore(adapter, "sessions");
    await store.initialize();
    await store.createSession("一");
    await store.createSession("二");
    expect(await store.listSessions()).toHaveLength(2);
    await store.clearSessions();
    expect(await store.listSessions()).toEqual([]);
  });
});

function memoryAdapter(): DataAdapter {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  return {
    exists: async (path: string) => files.has(path) || folders.has(path),
    mkdir: async (path: string) => { folders.add(path); },
    list: async (path: string) => ({
      files: [...files.keys()].filter((item) => item.startsWith(`${path}/`) && !item.slice(path.length + 1).includes("/")),
      folders: []
    }),
    read: async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw new Error("missing");
      return value;
    },
    write: async (path: string, data: string) => { files.set(path, data); },
    process: async (path: string, fn: (data: string) => string) => {
      const value = fn(files.get(path) ?? "");
      files.set(path, value);
      return value;
    },
    rename: async (from: string, to: string) => {
      const value = files.get(from);
      if (value === undefined) throw new Error("missing");
      files.set(to, value);
      files.delete(from);
    },
    remove: async (path: string) => { files.delete(path); }
  } as unknown as DataAdapter;
}
