import type { EditorPosition } from "obsidian";

export type ProviderKind = "openai-compatible" | "anthropic" | "gemini";

export interface ProviderProfile {
  id: string;
  kind: ProviderKind;
  name: string;
  baseURL: string;
  secretID: string;
  enabled: boolean;
}

export interface ModelOption {
  id: string;
  profileID: string;
  providerModelID: string;
  label: string;
  enabled: boolean;
}

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  modelID?: string;
  systemInstruction: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type WritingActionScope = "selection" | "cursor" | "both";

export type WritingApplyMode = "replace" | "insert-after" | "insert-cursor";

export interface WritingActionDefinition {
  id: string;
  name: string;
  description: string;
  instruction: string;
  scope: WritingActionScope;
  enabled: boolean;
  order: number;
  defaultApplyMode: WritingApplyMode;
  createdAt: number;
  updatedAt: number;
}

export type ModelSource = "agent" | "manual";

export type RuntimeState =
  | { status: "ready"; message: string }
  | { status: "missing-model"; message: string }
  | { status: "generating"; message: string }
  | { status: "error"; message: string };

export interface ChatSessionSummary {
  id: string;
  title: string;
  modelID?: string;
  agentID?: string;
  modelSource?: ModelSource;
  createdAt: number;
  updatedAt: number;
  status: "idle" | "generating" | "stopped" | "error";
}

export interface ChatMessage {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
  text: string;
  requestText?: string;
  createdAt: number;
  status?: "complete" | "generating" | "stopped" | "error";
  error?: string;
}

export interface ChatSession extends ChatSessionSummary {
  schemaVersion: 1;
  messages: ChatMessage[];
}

export interface ContextChip {
  id: string;
  type: "selection" | "paragraph" | "note";
  label: string;
  content: string;
  filePath: string;
  followsActiveNote?: boolean;
}

export interface EditorSnapshot {
  filePath: string;
  mode: "selection" | "cursor";
  from: EditorPosition;
  to: EditorPosition;
  originalText: string;
  cursor: EditorPosition;
  createdAt: number;
}

export interface ContextBundle {
  chips: ContextChip[];
  promptContext: string;
  snapshot: EditorSnapshot;
  fileTitle: string;
  headingPath: string[];
}

export interface GatewayMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerationUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface GenerationResult {
  text: string;
  finishReason?: string;
  usage?: GenerationUsage;
}

export interface GenerationRequest {
  model: ModelOption;
  profile: ProviderProfile;
  apiKey: string;
  messages: GatewayMessage[];
  signal?: AbortSignal;
  onText?: (fullText: string, delta: string) => void;
}

export interface ModelGateway {
  generate(request: GenerationRequest): Promise<GenerationResult>;
  listModels(profile: ProviderProfile, apiKey: string, signal?: AbortSignal): Promise<Array<{ id: string; label: string }>>;
}

export interface ApplyResult {
  ok: boolean;
  reason?: "file-changed" | "selection-changed" | "cursor-moved" | "no-editor";
}

export interface WriterCopilotSettings {
  profiles: ProviderProfile[];
  models: ModelOption[];
  agents: AgentProfile[];
  defaultAgentID?: string;
  chatModelID?: string;
  inlineModelID?: string;
  chatSystemInstruction: string;
  inlineSystemInstruction: string;
  writingActions: WritingActionDefinition[];
  defaultSelectionActionID?: string;
  defaultCursorActionID?: string;
  slashCommandsEnabled: boolean;
  attachCurrentNoteByDefault: boolean;
  enterToSend: boolean;
  sidebarPosition: "left" | "right";
}

export interface VaultState {
  currentSessionID?: string;
  draft: string;
  relatedNotes: Record<string, string[]>;
}

export interface PersistedData {
  schemaVersion: number;
  settings: WriterCopilotSettings;
  vaults: Record<string, VaultState>;
}
