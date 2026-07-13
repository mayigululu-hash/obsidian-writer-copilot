import { describe, expect, it } from "vitest";
import { AgentService, combineAgentInstruction } from "../src/agents/agent-service";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("AgentService", () => {
  it("creates, resolves and updates agents", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const service = new AgentService(() => settings);
    const agent = service.createAgent({ name: " 审稿 ", description: " 检查逻辑 ", systemInstruction: "严格审稿" });
    service.setDefaultAgent(agent.id);
    expect(service.resolveAgent(undefined)?.id).toBe(agent.id);
    expect(agent).toMatchObject({ name: "审稿", description: "检查逻辑", systemInstruction: "严格审稿" });
    service.updateAgent(agent.id, { ...agent, name: "文章审稿" });
    expect(service.getAgent(agent.id)?.name).toBe("文章审稿");
  });

  it("does not disable or delete the last enabled agent", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const service = new AgentService(() => settings);
    const only = settings.agents[0];
    expect(() => service.updateAgent(only.id, { ...only, enabled: false })).toThrow("至少需要保留一个启用的 Agent");
    expect(() => service.deleteAgent(only.id)).toThrow("不能删除最后一个启用的 Agent");
  });

  it("falls back from a missing agent and model", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.chatModelID = "global";
    const service = new AgentService(() => settings);
    expect(service.resolveAgent("missing")?.id).toBe(settings.defaultAgentID);
    const models = [
      { id: "global", profileID: "p", providerModelID: "g", label: "Global", enabled: true },
      { id: "first", profileID: "p", providerModelID: "f", label: "First", enabled: true }
    ];
    expect(service.resolveModel({ ...settings.agents[0], modelID: "missing" }, models, settings.chatModelID)?.id).toBe("global");
  });

  it("resolves manual, agent, global and first-available model priority", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const service = new AgentService(() => settings);
    const models = [
      { id: "first", profileID: "p", providerModelID: "f", label: "First", enabled: true },
      { id: "global", profileID: "p", providerModelID: "g", label: "Global", enabled: true },
      { id: "agent", profileID: "p", providerModelID: "a", label: "Agent", enabled: true },
      { id: "manual", profileID: "p", providerModelID: "m", label: "Manual", enabled: true }
    ];
    const agent = { ...settings.agents[0], modelID: "agent" };
    expect(service.resolveSessionModel("manual", "manual", agent, models, "global")?.id).toBe("manual");
    expect(service.resolveSessionModel("agent", "manual", agent, models, "global")?.id).toBe("agent");
    expect(service.resolveSessionModel("agent", undefined, { ...agent, modelID: "missing" }, models, "global")?.id).toBe("global");
    expect(service.resolveSessionModel("agent", undefined, { ...agent, modelID: "missing" }, models, "missing")?.id).toBe("first");
  });
});

describe("combineAgentInstruction", () => {
  it("preserves the old system instruction when the agent instruction is empty", () => {
    expect(combineAgentInstruction("全局规则", DEFAULT_SETTINGS.agents[0])).toBe("全局规则");
  });

  it("appends the agent name and instruction without its description", () => {
    const agent = { ...DEFAULT_SETTINGS.agents[0], name: "审稿", description: "不得发送", systemInstruction: "检查论证" };
    const combined = combineAgentInstruction("全局规则", agent);
    expect(combined).toContain("当前 Agent：审稿");
    expect(combined).toContain("检查论证");
    expect(combined).not.toContain("不得发送");
  });
});
