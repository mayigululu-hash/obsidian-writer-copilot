import type { AgentProfile, PersistedData, ProviderKind, ProviderProfile, WriterCopilotSettings, WritingActionDefinition } from "./types";
import { INITIAL_WRITING_ACTIONS } from "./writing/actions";

export const DEFAULT_AGENT: AgentProfile = {
  id: "agent-writing-default",
  name: "写作助手",
  description: "日常写作与讨论",
  systemInstruction: "",
  enabled: true,
  createdAt: 0,
  updatedAt: 0
};

export const DEFAULT_SETTINGS: WriterCopilotSettings = {
  profiles: [],
  models: [],
  agents: [structuredClone(DEFAULT_AGENT)],
  defaultAgentID: DEFAULT_AGENT.id,
  chatSystemInstruction: "你是一位严谨、自然的中文写作助手。优先理解用户附加的笔记内容，不虚构事实，回答尽量可直接用于写作。",
  inlineSystemInstruction: "你是 Obsidian 中的中文写作助手。只输出可以直接放回文章的正文，不解释处理过程。",
  writingActions: structuredClone(INITIAL_WRITING_ACTIONS),
  defaultSelectionActionID: "action-rewrite",
  defaultCursorActionID: "action-continue",
  slashCommandsEnabled: true,
  attachCurrentNoteByDefault: true,
  enterToSend: true,
  sidebarPosition: "right"
};

const CURRENT_SCHEMA_VERSION = 5;

export function normalizePersistedData(raw: unknown): PersistedData {
  const data = isRecord(raw) ? raw : {};
  const storedSettings = isRecord(data.settings) ? data.settings : {};
  const schemaVersion = typeof data.schemaVersion === "number" ? data.schemaVersion : 1;
  const profiles = arrayOfRecords(storedSettings.profiles).map(normalizeProfile).filter(isDefined);
  const models = arrayOfRecords(storedSettings.models).map((model) => ({
    id: text(model.id),
    profileID: text(model.profileID),
    providerModelID: text(model.providerModelID),
    label: text(model.label) || text(model.providerModelID),
    enabled: model.enabled !== false
  })).filter((model) => model.id && model.profileID && model.providerModelID);
  const agents = arrayOfRecords(storedSettings.agents).map(normalizeAgent).filter(isDefined);
  if (!agents.length) agents.push(structuredClone(DEFAULT_AGENT));
  if (!agents.some((agent) => agent.enabled)) agents[0].enabled = true;
  const storedDefaultAgentID = text(storedSettings.defaultAgentID);
  const defaultAgentID = agents.some((agent) => agent.id === storedDefaultAgentID && agent.enabled)
    ? storedDefaultAgentID
    : agents.find((agent) => agent.enabled)?.id;
  const hasStoredActions = Array.isArray(storedSettings.writingActions);
  const writingActions = hasStoredActions
    ? arrayOfRecords(storedSettings.writingActions).map(normalizeWritingAction).filter(isDefined)
    : structuredClone(INITIAL_WRITING_ACTIONS);
  normalizeActionOrder(writingActions);
  const storedSelectionDefault = text(storedSettings.defaultSelectionActionID);
  const storedCursorDefault = text(storedSettings.defaultCursorActionID);
  const defaultSelectionActionID = resolveActionDefault(
    writingActions,
    storedSelectionDefault || (hasStoredActions ? "" : DEFAULT_SETTINGS.defaultSelectionActionID),
    "selection"
  );
  const defaultCursorActionID = resolveActionDefault(
    writingActions,
    storedCursorDefault || (hasStoredActions ? "" : DEFAULT_SETTINGS.defaultCursorActionID),
    "cursor"
  );
  const settings: WriterCopilotSettings = {
    ...DEFAULT_SETTINGS,
    profiles,
    models,
    agents,
    defaultAgentID,
    chatModelID: text(storedSettings.chatModelID) || undefined,
    inlineModelID: text(storedSettings.inlineModelID) || undefined,
    chatSystemInstruction: text(storedSettings.chatSystemInstruction) || DEFAULT_SETTINGS.chatSystemInstruction,
    inlineSystemInstruction: text(storedSettings.inlineSystemInstruction) || DEFAULT_SETTINGS.inlineSystemInstruction,
    writingActions,
    defaultSelectionActionID,
    defaultCursorActionID,
    slashCommandsEnabled: typeof storedSettings.slashCommandsEnabled === "boolean" ? storedSettings.slashCommandsEnabled : true,
    attachCurrentNoteByDefault: typeof storedSettings.attachCurrentNoteByDefault === "boolean"
      ? storedSettings.attachCurrentNoteByDefault
      : true,
    enterToSend: typeof storedSettings.enterToSend === "boolean" ? storedSettings.enterToSend : true,
    sidebarPosition: storedSettings.sidebarPosition === "left" ? "left" : "right"
  };
  if (!settings.chatModelID) settings.chatModelID = settings.models.find((model) => model.enabled)?.id;
  if (schemaVersion < 2) settings.attachCurrentNoteByDefault = true;

  const rawVaults = isRecord(data.vaults) ? data.vaults : {};
  const vaults: PersistedData["vaults"] = {};
  for (const [key, value] of Object.entries(rawVaults)) {
    const stored = isRecord(value) ? value : {};
    vaults[key] = {
      currentSessionID: schemaVersion >= 3 && typeof stored.currentSessionID === "string" ? stored.currentSessionID : undefined,
      draft: typeof stored.draft === "string" ? stored.draft : "",
      relatedNotes: isRecord(stored.relatedNotes) ? stored.relatedNotes as Record<string, string[]> : {}
    };
  }
  return { schemaVersion: CURRENT_SCHEMA_VERSION, settings, vaults };
}

export function createProviderProfile(kind: ProviderKind): ProviderProfile {
  const id = `${kind}-${Date.now().toString(36)}`;
  const defaults: Record<ProviderKind, { name: string; baseURL: string }> = {
    "openai-compatible": { name: "OpenAI 兼容", baseURL: "https://api.openai.com/v1" },
    anthropic: { name: "Anthropic", baseURL: "https://api.anthropic.com/v1" },
    gemini: { name: "Google Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta" }
  };
  return { id, kind, ...defaults[kind], secretID: `writer-copilot-${id}`, enabled: true };
}

function normalizeProfile(value: Record<string, unknown>): ProviderProfile | undefined {
  const kind = value.kind;
  if (kind !== "openai-compatible" && kind !== "anthropic" && kind !== "gemini") return undefined;
  const id = text(value.id);
  if (!id) return undefined;
  return {
    id,
    kind,
    name: text(value.name) || id,
    baseURL: text(value.baseURL),
    secretID: text(value.secretID) || `writer-copilot-${id}`,
    enabled: value.enabled !== false
  };
}

function normalizeAgent(value: Record<string, unknown>): AgentProfile | undefined {
  const id = text(value.id);
  if (!id) return undefined;
  const createdAt = finiteNumber(value.createdAt, Date.now());
  return {
    id,
    name: (text(value.name) || "未命名 Agent").slice(0, 40),
    description: typeof value.description === "string" ? value.description.trim().slice(0, 120) : "",
    modelID: text(value.modelID) || undefined,
    systemInstruction: typeof value.systemInstruction === "string" ? value.systemInstruction.slice(0, 8_000) : "",
    enabled: value.enabled !== false,
    createdAt,
    updatedAt: finiteNumber(value.updatedAt, createdAt)
  };
}

function normalizeWritingAction(value: Record<string, unknown>): WritingActionDefinition | undefined {
  const id = text(value.id);
  const name = text(value.name).slice(0, 40);
  const instruction = typeof value.instruction === "string" ? value.instruction.trim().slice(0, 8_000) : "";
  if (!id || !name || !instruction) return undefined;
  const scope = value.scope === "cursor" || value.scope === "both" ? value.scope : "selection";
  const defaultApplyMode = value.defaultApplyMode === "insert-after" || value.defaultApplyMode === "insert-cursor"
    ? value.defaultApplyMode
    : "replace";
  const createdAt = finiteNumber(value.createdAt, Date.now());
  return {
    id,
    name,
    description: typeof value.description === "string" ? value.description.trim().slice(0, 120) : "",
    instruction,
    scope,
    enabled: value.enabled !== false,
    order: finiteNumber(value.order, Number.MAX_SAFE_INTEGER),
    defaultApplyMode,
    createdAt,
    updatedAt: finiteNumber(value.updatedAt, createdAt)
  };
}

function normalizeActionOrder(actions: WritingActionDefinition[]): void {
  actions.sort((left, right) => left.order - right.order || left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  actions.forEach((action, index) => { action.order = index; });
}

function resolveActionDefault(
  actions: WritingActionDefinition[],
  id: string | undefined,
  scope: "selection" | "cursor"
): string | undefined {
  return actions.some((action) => action.id === id && action.enabled && (action.scope === scope || action.scope === "both")) ? id : undefined;
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
