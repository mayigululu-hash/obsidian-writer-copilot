import { FileSystemAdapter, Notice, Plugin, normalizePath } from "obsidian";
import type {
  ChatMessage,
  ChatSessionSummary,
  AgentProfile,
  ContextBundle,
  ModelOption,
  ModelSource,
  PersistedData,
  ProviderProfile,
  RuntimeState,
  VaultState,
  WriterCopilotSettings,
  WritingActionDefinition
} from "./types";
import { DEFAULT_SETTINGS, normalizePersistedData } from "./settings";
import { NativeModelGateway, ProviderRequestError, toGatewayMessages } from "./ai/model-gateway";
import { SessionStore } from "./sessions/session-store";
import { ContextService } from "./context/context-service";
import { EditorService } from "./editor/editor-service";
import { buildInlinePrompt } from "./writing/actions";
import { CopilotView, COPILOT_VIEW_TYPE } from "./ui/copilot-view";
import { CustomInstructionModal, InlinePreviewModal, WritingActionPicker } from "./ui/inline-modal";
import { WriterCopilotSettingsTab } from "./ui/settings-tab";
import { AgentService, combineAgentInstruction, type AgentInput } from "./agents/agent-service";
import { WritingActionService } from "./writing/action-service";
import { finalizeInlineOutput, previewInlineOutput } from "./writing/inline-output-guard";
import { WritingSlashSuggest } from "./ui/writing-slash-suggest";

export default class WriterCopilotPlugin extends Plugin {
  settings: WriterCopilotSettings = structuredClone(DEFAULT_SETTINGS);
  runtime: RuntimeState = { status: "missing-model", message: "请先添加模型" };
  contextService!: ContextService;
  editorService!: EditorService;
  private data!: PersistedData;
  private readonly modelGateway = new NativeModelGateway();
  private sessionStore!: SessionStore;
  private listeners = new Set<() => void>();
  private sessionModelCache = new Map<string, string | undefined>();
  private sessionAgentCache = new Map<string, string | undefined>();
  private sessionModelSourceCache = new Map<string, ModelSource>();
  private readonly agentService = new AgentService(() => this.settings);
  readonly writingActionService = new WritingActionService(() => this.settings);
  private settingsTab?: WriterCopilotSettingsTab;

  get models(): ModelOption[] {
    return this.settings.models.filter((model) => model.enabled && this.settings.profiles.some((profile) => profile.id === model.profileID && profile.enabled));
  }

  get agents(): AgentProfile[] {
    return this.agentService.listAgents();
  }

  get enabledAgents(): AgentProfile[] {
    return this.agents.filter((agent) => agent.enabled);
  }

  async onload(): Promise<void> {
    this.data = normalizePersistedData(await this.loadData());
    this.settings = this.data.settings;
    await this.saveData(this.data);
    this.contextService = new ContextService(this.app);
    this.editorService = new EditorService(this.app);
    const pluginDirectory = this.manifest.dir ?? normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}`);
    this.sessionStore = new SessionStore(this.app.vault.adapter, normalizePath(`${pluginDirectory}/sessions`));
    await this.sessionStore.initialize();
    this.refreshRuntime();

    this.registerView(COPILOT_VIEW_TYPE, (leaf) => new CopilotView(leaf, this));
    this.addRibbonIcon("sparkles", "打开 Writer Copilot", () => void this.openCopilotView());
    this.addCommand({ id: "open-writer-copilot", name: "打开 Writer Copilot", callback: () => void this.openCopilotView() });
    this.addCommand({
      id: "writer-copilot-rewrite-selection",
      name: "改写选中文字",
      editorCheckCallback: (checking, editor) => {
        if (!editor.getSelection()) return false;
        if (!checking) this.openSelectionActions();
        return true;
      }
    });
    this.addCommand({ id: "writer-copilot-continue-paragraph", name: "打开续写动作", editorCallback: () => this.openCursorActions() });
    this.addCommand({ id: "writer-copilot-next-paragraph", name: "使用默认续写动作", editorCallback: () => this.openDefaultCursorAction() });
    this.registerEditorSuggest(new WritingSlashSuggest(this));
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor) => {
      if (!editor.getSelection()) return;
      menu.addItem((item) => item.setTitle("Writer Copilot…").setIcon("sparkles").setSection("writer-copilot").onClick(() => this.openSelectionActions()));
    }));
    this.settingsTab = new WriterCopilotSettingsTab(this);
    this.addSettingTab(this.settingsTab);
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(COPILOT_VIEW_TYPE);
  }

  async createSession(): Promise<ChatSessionSummary> {
    const agent = this.agentService.resolveAgent(this.settings.defaultAgentID);
    const model = this.agentService.resolveModel(agent, this.models, this.settings.chatModelID);
    const session = await this.sessionStore.createSession("新对话", model?.id, agent?.id, "agent");
    this.sessionModelCache.set(session.id, session.modelID);
    this.sessionAgentCache.set(session.id, session.agentID);
    this.sessionModelSourceCache.set(session.id, session.modelSource ?? "agent");
    return session;
  }

  async listSessions(): Promise<ChatSessionSummary[]> {
    return this.sessionStore.listSessions();
  }

  async getMessages(sessionID: string): Promise<ChatMessage[]> {
    const session = await this.sessionStore.getSession(sessionID);
    this.sessionModelCache.set(session.id, session.modelID);
    this.sessionAgentCache.set(session.id, session.agentID);
    this.sessionModelSourceCache.set(session.id, session.modelSource ?? "manual");
    return session.messages;
  }

  async renameSession(sessionID: string, title: string): Promise<void> {
    await this.sessionStore.renameSession(sessionID, title);
    this.notify();
  }

  async deleteSession(sessionID: string): Promise<void> {
    await this.sessionStore.deleteSession(sessionID);
    this.sessionModelCache.delete(sessionID);
    this.sessionAgentCache.delete(sessionID);
    this.sessionModelSourceCache.delete(sessionID);
    this.notify();
  }

  async clearAllSessions(): Promise<void> {
    await this.sessionStore.clearSessions();
    this.sessionModelCache.clear();
    this.sessionAgentCache.clear();
    this.sessionModelSourceCache.clear();
    this.vaultState().currentSessionID = undefined;
    await this.savePluginData();
  }

  async resetSettings(): Promise<void> {
    for (const profile of this.settings.profiles) this.setSecret(profile.secretID, "");
    this.settings = structuredClone(DEFAULT_SETTINGS);
    await this.savePluginData();
  }

  async createAgent(input: AgentInput): Promise<AgentProfile> {
    const agent = this.agentService.createAgent(input);
    await this.savePluginData();
    return agent;
  }

  async updateAgent(id: string, input: AgentInput): Promise<AgentProfile> {
    const agent = this.agentService.updateAgent(id, input);
    await this.savePluginData();
    return agent;
  }

  async deleteAgent(id: string): Promise<void> {
    this.agentService.deleteAgent(id);
    await this.savePluginData();
  }

  async setDefaultAgent(id: string): Promise<AgentProfile> {
    const agent = this.agentService.setDefaultAgent(id);
    await this.savePluginData();
    return agent;
  }

  async generateChat(
    sessionID: string,
    userText: string,
    prompt: string,
    signal: AbortSignal,
    onText: (text: string) => void
  ): Promise<string> {
    const agent = this.sessionAgent(sessionID);
    const model = this.requireModel(this.sessionModel(sessionID)?.id);
    const profile = this.requireProfile(model.profileID);
    const apiKey = this.getSecret(profile.secretID);
    const userID = crypto.randomUUID();
    const assistantID = crypto.randomUUID();
    await this.sessionStore.appendMessage(sessionID, { id: userID, role: "user", text: userText, requestText: prompt, createdAt: Date.now(), status: "complete" });
    await this.sessionStore.appendMessage(sessionID, { id: assistantID, role: "assistant", text: "", createdAt: Date.now(), status: "generating" });
    this.runtime = { status: "generating", message: `正在使用 ${model.label}` };
    this.notify();
    let latest = "";
    let savedLength = 0;
    let savedAt = Date.now();
    let checkpoint = Promise.resolve();
    try {
      const history = (await this.sessionStore.getMessages(sessionID))
        .filter((message) => message.id !== assistantID && message.text.trim())
        .map((message) => ({ role: message.role, text: message.requestText ?? message.text }));
      const result = await this.modelGateway.generate({
        model,
        profile,
        apiKey,
        messages: toGatewayMessages(combineAgentInstruction(this.settings.chatSystemInstruction, agent), history),
        signal,
        onText: (fullText) => {
          latest = fullText;
          onText(fullText);
          if (fullText.length - savedLength >= 1024 || Date.now() - savedAt >= 1000) {
            savedLength = fullText.length;
            savedAt = Date.now();
            checkpoint = checkpoint.then(() => this.sessionStore.updateAssistant(sessionID, assistantID, fullText, "generating"));
          }
        }
      });
      latest = result.text;
      await checkpoint;
      await this.sessionStore.updateAssistant(sessionID, assistantID, result.text, "complete");
      return result.text;
    } catch (error) {
      await checkpoint.catch(() => undefined);
      const aborted = isAbortError(error) || signal.aborted;
      await this.sessionStore.updateAssistant(sessionID, assistantID, latest, aborted ? "stopped" : "error", aborted ? undefined : this.errorMessage(error));
      throw error;
    } finally {
      this.refreshRuntime();
      this.notify();
    }
  }

  async generateInline(
    action: WritingActionDefinition,
    bundle: ContextBundle,
    onText: (text: string) => void,
    signal: AbortSignal
  ): Promise<string> {
    const model = this.requireModel(this.settings.inlineModelID ?? this.settings.chatModelID);
    const profile = this.requireProfile(model.profileID);
    const prompt = buildInlinePrompt(action, bundle);
    const result = await this.modelGateway.generate({
      model,
      profile,
      apiKey: this.getSecret(profile.secretID),
      messages: toGatewayMessages(this.settings.inlineSystemInstruction, [{ role: "user", text: prompt }]),
      signal,
      onText: (text) => onText(previewInlineOutput(text))
    });
    const validated = finalizeInlineOutput(result.text);
    if (!validated.valid) throw new Error(validated.error ?? "模型没有返回可写入的正文");
    onText(validated.text);
    return validated.text;
  }

  async discoverModels(profileID: string): Promise<Array<{ id: string; label: string }>> {
    const profile = this.requireProfile(profileID);
    return this.modelGateway.listModels(profile, this.getSecret(profile.secretID));
  }

  async testProfile(profileID: string): Promise<number> {
    const models = await this.discoverModels(profileID);
    return models.length;
  }

  setSecret(secretID: string, value: string): void {
    this.app.secretStorage.setSecret(secretID, value.trim());
    this.refreshRuntime();
    this.notify();
  }

  getSecret(secretID: string): string {
    return this.app.secretStorage.getSecret(secretID) ?? "";
  }

  hasSecret(secretID: string): boolean {
    return Boolean(this.getSecret(secretID));
  }

  modelByID(id: string | undefined): ModelOption | undefined {
    return id ? this.settings.models.find((model) => model.id === id) : undefined;
  }

  sessionModel(sessionID: string | undefined): ModelOption | undefined {
    if (!sessionID) {
      const agent = this.agentService.resolveAgent(this.settings.defaultAgentID);
      return this.agentService.resolveModel(agent, this.models, this.settings.chatModelID);
    }
    const source = this.sessionModelSourceCache.get(sessionID) ?? "manual";
    const selected = this.sessionModelID(sessionID);
    return this.agentService.resolveSessionModel(
      source,
      selected,
      this.sessionAgent(sessionID),
      this.models,
      this.settings.chatModelID
    );
  }

  async setSessionModel(sessionID: string, modelID: string | undefined): Promise<void> {
    await this.sessionStore.setModel(sessionID, modelID, "manual");
    this.sessionModelCache.set(sessionID, modelID);
    this.sessionModelSourceCache.set(sessionID, "manual");
    this.notify();
  }

  sessionAgent(sessionID: string | undefined): AgentProfile | undefined {
    const id = sessionID ? this.sessionAgentCache.get(sessionID) : this.settings.defaultAgentID;
    return this.agentService.resolveAgent(id);
  }

  async setSessionAgent(sessionID: string, agentID: string | undefined): Promise<AgentProfile | undefined> {
    const agent = this.agentService.resolveAgent(agentID);
    const model = this.agentService.resolveModel(agent, this.models, this.settings.chatModelID);
    await this.sessionStore.setAgent(sessionID, agent?.id, model?.id);
    this.sessionAgentCache.set(sessionID, agent?.id);
    this.sessionModelCache.set(sessionID, model?.id);
    this.sessionModelSourceCache.set(sessionID, "agent");
    this.notify();
    return agent;
  }

  async openCopilotView(prefill?: string): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(COPILOT_VIEW_TYPE)[0];
    if (!leaf) {
      const sideLeaf = this.settings.sidebarPosition === "left"
        ? this.app.workspace.getLeftLeaf(false)
        : this.app.workspace.getRightLeaf(false);
      leaf = sideLeaf ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: COPILOT_VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof CopilotView) leaf.view.focusComposer(prefill);
  }

  openSettings(): void {
    const app = this.app as typeof this.app & { setting?: { open(): void; openTabById(id: string): void } };
    app.setting?.open();
    app.setting?.openTabById(this.manifest.id);
  }

  openWritingSettings(): void {
    this.openSettings();
    window.setTimeout(() => this.settingsTab?.show("writing"), 0);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  vaultState(): VaultState {
    const key = this.vaultRoot();
    this.data.vaults[key] ??= { draft: "", relatedNotes: {} };
    return this.data.vaults[key];
  }

  async setCurrentSession(id: string | undefined): Promise<void> {
    this.vaultState().currentSessionID = id;
    await this.savePluginData();
  }

  async setDraft(draft: string): Promise<void> {
    this.vaultState().draft = draft;
    await this.savePluginData();
  }

  async savePluginData(): Promise<void> {
    this.data.settings = this.settings;
    await this.saveData(this.data);
    this.refreshRuntime();
    this.notify();
  }

  diagnosticText(): string {
    return [
      `插件版本：${this.manifest.version}`,
      `后端：Obsidian 原生模型网关`,
      `Vault：${this.vaultRoot()}`,
      `提供商：${this.settings.profiles.filter((item) => item.enabled).length}`,
      `可用模型：${this.models.length}`,
      `启用 Agent：${this.enabledAgents.length}`,
      `启用写作动作：${this.writingActionService.list(undefined, true).length}`,
      `空白行 / 菜单：${this.settings.slashCommandsEnabled ? "已启用" : "已关闭"}`,
      `状态：${this.runtime.message}`
    ].join("\n");
  }

  errorMessage(error: unknown): string {
    if (error instanceof ProviderRequestError) return error.message;
    if (error instanceof Error) return error.message;
    return String(error ?? "未知错误");
  }

  private requireModel(id: string | undefined): ModelOption {
    const model = this.modelByID(id);
    if (!model || !model.enabled) throw new Error("请先在 Writer Copilot 设置中添加并选择模型");
    return model;
  }

  private requireProfile(id: string): ProviderProfile {
    const profile = this.settings.profiles.find((item) => item.id === id && item.enabled);
    if (!profile) throw new Error("当前模型对应的提供商已被删除或禁用");
    return profile;
  }

  private sessionModelID(sessionID: string): string | undefined {
    return this.sessionModelCache.get(sessionID);
  }

  private refreshRuntime(): void {
    if (!this.models.length) this.runtime = { status: "missing-model", message: "请先添加模型" };
    else if (!this.models.some((model) => {
      const profile = this.settings.profiles.find((item) => item.id === model.profileID);
      return profile && (profile.kind === "openai-compatible" || this.hasSecret(profile.secretID));
    })) this.runtime = { status: "missing-model", message: "请为模型提供商配置 API Key" };
    else this.runtime = { status: "ready", message: "模型就绪" };
  }

  openSelectionActions(): void {
    const bundle = this.contextService.getSelectionBundle();
    if (!bundle) {
      new Notice("请先选择要修改的文字");
      return;
    }
    new WritingActionPicker(this, bundle, true).open();
  }

  openCursorActions(): void {
    const bundle = this.contextService.getCursorBundle();
    if (!bundle) return;
    new WritingActionPicker(this, bundle, false).open();
  }

  openInlinePreview(bundle: ContextBundle, action: WritingActionDefinition): void {
    new InlinePreviewModal(this, bundle, action).open();
  }

  openCustomInline(bundle: ContextBundle, action: WritingActionDefinition): void {
    new CustomInstructionModal(this, bundle, action).open();
  }

  private openDefaultCursorAction(): void {
    const bundle = this.contextService.getCursorBundle();
    if (!bundle) return;
    const action = this.settings.defaultCursorActionID
      ? this.writingActionService.get(this.settings.defaultCursorActionID)
      : undefined;
    if (!action?.enabled) {
      this.openCursorActions();
      return;
    }
    this.openInlinePreview(bundle, action);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private vaultRoot(): string {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) return adapter.getBasePath();
    return this.app.vault.getName();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
