import type { AgentProfile, ModelOption, ModelSource, WriterCopilotSettings } from "../types";

export interface AgentInput {
  name: string;
  description?: string;
  modelID?: string;
  systemInstruction?: string;
  enabled?: boolean;
}

export class AgentService {
  constructor(private readonly settings: () => WriterCopilotSettings) {}

  listAgents(): AgentProfile[] {
    return [...this.settings().agents].sort((left, right) => left.createdAt - right.createdAt);
  }

  getAgent(id: string | undefined): AgentProfile | undefined {
    return id ? this.settings().agents.find((agent) => agent.id === id) : undefined;
  }

  resolveAgent(id: string | undefined): AgentProfile | undefined {
    const settings = this.settings();
    return settings.agents.find((agent) => agent.id === id && agent.enabled)
      ?? settings.agents.find((agent) => agent.id === settings.defaultAgentID && agent.enabled)
      ?? settings.agents.find((agent) => agent.enabled);
  }

  createAgent(input: AgentInput): AgentProfile {
    const normalized = validateAgentInput(input);
    const now = Date.now();
    const agent: AgentProfile = {
      id: `agent-${crypto.randomUUID()}`,
      ...normalized,
      enabled: input.enabled !== false,
      createdAt: now,
      updatedAt: now
    };
    this.settings().agents.push(agent);
    return agent;
  }

  updateAgent(id: string, patch: AgentInput): AgentProfile {
    const agent = this.requireAgent(id);
    const normalized = validateAgentInput({
      name: patch.name,
      description: patch.description,
      modelID: patch.modelID,
      systemInstruction: patch.systemInstruction
    });
    if (patch.enabled === false && agent.enabled && this.enabledAgents().length === 1) {
      throw new Error("至少需要保留一个启用的 Agent");
    }
    Object.assign(agent, normalized, { enabled: patch.enabled ?? agent.enabled, updatedAt: Date.now() });
    if (!agent.enabled && this.settings().defaultAgentID === agent.id) {
      this.settings().defaultAgentID = this.enabledAgents()[0]?.id;
    }
    return agent;
  }

  deleteAgent(id: string): void {
    const agent = this.requireAgent(id);
    if (agent.enabled && this.enabledAgents().length === 1) throw new Error("不能删除最后一个启用的 Agent");
    const settings = this.settings();
    settings.agents = settings.agents.filter((item) => item.id !== id);
    if (settings.defaultAgentID === id) settings.defaultAgentID = this.enabledAgents()[0]?.id;
  }

  setDefaultAgent(id: string): AgentProfile {
    const agent = this.requireAgent(id);
    if (!agent.enabled) throw new Error("请先启用这个 Agent");
    this.settings().defaultAgentID = agent.id;
    return agent;
  }

  resolveModel(agent: AgentProfile | undefined, availableModels: ModelOption[], globalModelID: string | undefined): ModelOption | undefined {
    return availableModels.find((model) => model.id === agent?.modelID)
      ?? availableModels.find((model) => model.id === globalModelID)
      ?? availableModels[0];
  }

  resolveSessionModel(
    modelSource: ModelSource,
    sessionModelID: string | undefined,
    agent: AgentProfile | undefined,
    availableModels: ModelOption[],
    globalModelID: string | undefined
  ): ModelOption | undefined {
    if (modelSource === "manual") {
      const manual = availableModels.find((model) => model.id === sessionModelID);
      if (manual) return manual;
    }
    return this.resolveModel(agent, availableModels, globalModelID);
  }

  private requireAgent(id: string): AgentProfile {
    const agent = this.getAgent(id);
    if (!agent) throw new Error("Agent 不存在或已被删除");
    return agent;
  }

  private enabledAgents(): AgentProfile[] {
    return this.settings().agents.filter((agent) => agent.enabled);
  }
}

export function combineAgentInstruction(globalInstruction: string, agent: AgentProfile | undefined): string {
  const base = globalInstruction.trim();
  const instruction = agent?.systemInstruction.trim();
  if (!agent || !instruction) return base;
  return [base, `当前 Agent：${agent.name}`, instruction].filter(Boolean).join("\n\n");
}

function validateAgentInput(input: AgentInput): Pick<AgentProfile, "name" | "description" | "modelID" | "systemInstruction"> {
  const name = input.name.trim();
  if (!name) throw new Error("请输入 Agent 名称");
  if (name.length > 40) throw new Error("Agent 名称不能超过 40 个字符");
  const description = (input.description ?? "").trim();
  if (description.length > 120) throw new Error("Agent 说明不能超过 120 个字符");
  const systemInstruction = input.systemInstruction ?? "";
  if (systemInstruction.length > 8_000) throw new Error("System Instruction 不能超过 8000 个字符");
  return { name, description, modelID: input.modelID?.trim() || undefined, systemInstruction };
}
