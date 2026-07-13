import {
  ItemView,
  MarkdownRenderer,
  Menu,
  Modal,
  Notice,
  TFile,
  setIcon,
  type WorkspaceLeaf
} from "obsidian";
import type WriterCopilotPlugin from "../main";
import type { ChatMessage, ChatSessionSummary, ContextChip } from "../types";
import { buildChatPrompt } from "../writing/actions";
import { NotePickerModal } from "./note-picker-modal";

export const COPILOT_VIEW_TYPE = "writer-copilot-view";

export class CopilotView extends ItemView {
  private bodyEl!: HTMLElement;
  private composerEl!: HTMLElement;
  private contextEl!: HTMLElement;
  private footerEl!: HTMLElement;
  private headerMetaEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private agentSelect!: HTMLSelectElement;
  private modelSelect!: HTMLSelectElement;
  private sendButton!: HTMLButtonElement;
  private historyMode = false;
  private currentNoteRemoved = false;
  private messages: ChatMessage[] = [];
  private sessions: ChatSessionSummary[] = [];
  private contexts: ContextChip[] = [];
  private currentSessionID?: string;
  private currentFile?: TFile;
  private generationAbort?: AbortController;
  private unsubscribe?: () => void;
  private draftSaveTimer?: number;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: WriterCopilotPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return COPILOT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Writer Copilot";
  }

  getIcon(): string {
    return "sparkles";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("writer-copilot-view");
    this.buildShell();
    this.unsubscribe = this.plugin.subscribe(() => {
      this.renderConnection();
      this.renderAgentOptions();
      this.renderModelOptions();
      if (!this.historyMode) this.renderMessages();
    });
    this.currentFile = this.resolveCurrentFile();
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (file) this.currentFile = file;
      void this.refreshFollowingCurrentNote();
    }));
    const vaultState = this.plugin.vaultState();
    this.currentSessionID = vaultState.currentSessionID;
    this.inputEl.value = vaultState.draft;
    this.resetContexts();
    window.setTimeout(() => {
      if (!this.currentNoteRemoved && this.contexts.length === 0 && this.plugin.settings.attachCurrentNoteByDefault) void this.attachCurrentNote();
    }, 350);
    this.renderAgentOptions();
    this.renderModelOptions();
    if (this.currentSessionID) await this.loadSession(this.currentSessionID);
    else this.renderMessages();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.generationAbort?.abort();
    if (this.draftSaveTimer) window.clearTimeout(this.draftSaveTimer);
  }

  focusComposer(prefill?: string): void {
    if (prefill) {
      this.inputEl.value = prefill;
      void this.plugin.setDraft(prefill);
    }
    this.inputEl.focus();
  }

  async newSession(): Promise<void> {
    try {
      const session = await this.plugin.createSession();
      this.currentSessionID = session.id;
      this.messages = [];
      await this.plugin.setCurrentSession(session.id);
      this.historyMode = false;
      this.resetContexts();
      this.renderHeaderTitle("新对话");
      this.renderAgentOptions();
      this.renderModelOptions();
      this.renderMessages();
      this.inputEl.focus();
    } catch (error) {
      new Notice(this.plugin.errorMessage(error));
      this.renderMessages();
    }
  }

  private buildShell(): void {
    this.contentEl.empty();
    const header = this.contentEl.createDiv({ cls: "wc-header" });
    const titleArea = header.createDiv({ cls: "wc-title-area" });
    const titleButton = titleArea.createEl("button", { cls: "wc-title-button", attr: { "aria-label": "切换历史会话" } });
    const title = titleButton.createSpan({ cls: "wc-title", text: "新对话" });
    title.dataset.role = "session-title";
    const chevron = titleButton.createSpan({ cls: "wc-title-chevron" });
    setIcon(chevron, "chevron-down");
    titleButton.addEventListener("click", () => void this.showHistory());
    this.headerMetaEl = titleArea.createDiv({ cls: "wc-header-meta" });
    const headerActions = header.createDiv({ cls: "wc-header-actions" });
    this.iconButton(headerActions, "plus", "新对话", () => void this.newSession());
    this.iconButton(headerActions, "ellipsis", "会话与诊断", (event) => this.showCurrentSessionMenu(event));

    this.bodyEl = this.contentEl.createDiv({ cls: "wc-body" });
    this.composerEl = this.contentEl.createDiv({ cls: "wc-composer" });
    this.contextEl = this.composerEl.createDiv({ cls: "wc-context-chips" });
    this.inputEl = this.composerEl.createEl("textarea", {
      cls: "wc-input",
      attr: { placeholder: "使用 AI 处理写作任务…", rows: "4", "aria-label": "聊天输入" }
    });
    this.inputEl.addEventListener("input", () => this.scheduleDraftSave());
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      const shouldSend = this.plugin.settings.enterToSend
        ? event.key === "Enter" && !event.shiftKey
        : event.key === "Enter" && (event.metaKey || event.ctrlKey);
      if (shouldSend) {
        event.preventDefault();
        void this.sendMessage();
      }
    });

    const composerActions = this.composerEl.createDiv({ cls: "wc-composer-actions" });
    const composerLeft = composerActions.createDiv({ cls: "wc-composer-left" });
    this.iconButton(composerLeft, "plus", "添加上下文", (event) => this.showContextMenu(event));
    this.agentSelect = composerLeft.createEl("select", {
      cls: "wc-agent-select",
      attr: { "aria-label": "选择 Agent", title: "当前会话 Agent" }
    });
    this.agentSelect.addEventListener("change", () => void this.changeAgent());
    const composerRight = composerActions.createDiv({ cls: "wc-composer-right" });
    this.modelSelect = composerRight.createEl("select", { cls: "wc-model-select", attr: { "aria-label": "选择模型", title: "当前会话模型" } });
    this.modelSelect.addEventListener("change", () => void this.changeModel());
    this.sendButton = composerRight.createEl("button", { text: "发送", cls: "mod-cta wc-send-button" });
    this.sendButton.addEventListener("click", () => {
      if (this.generationAbort) this.stopGeneration();
      else void this.sendMessage();
    });
    this.footerEl = this.contentEl.createDiv({ cls: "wc-footer" });
    this.renderContexts();
    this.renderConnection();
    this.renderAgentOptions();
    this.renderModelOptions();
  }

  private async sendMessage(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text || this.generationAbort) return;
    let optimisticAssistant: ChatMessage | undefined;
    try {
      if (!this.currentSessionID) await this.newSession();
      if (!this.currentSessionID) return;
      await this.refreshNoteContexts();
      this.historyMode = false;
      const sessionID = this.currentSessionID;
      const optimisticUser: ChatMessage = {
        id: `local-user-${Date.now()}`,
        sessionID,
        role: "user",
        text,
        createdAt: Date.now()
      };
      optimisticAssistant = {
        id: `local-assistant-${Date.now()}`,
        sessionID,
        role: "assistant",
        text: "",
        createdAt: Date.now()
      };
      this.messages.push(optimisticUser, optimisticAssistant);
      this.inputEl.value = "";
      await this.plugin.setDraft("");
      this.renderMessages();
      this.generationAbort = new AbortController();
      this.sendButton.setText("停止");
      const prompt = buildChatPrompt(text, this.contexts);
      await this.plugin.generateChat(
        sessionID,
        text,
        prompt,
        this.generationAbort.signal,
        (value) => {
          if (!optimisticAssistant) return;
          optimisticAssistant.text = value;
          this.renderMessages();
        }
      );
      await this.loadSession(sessionID);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        const message = this.plugin.errorMessage(error);
        if (optimisticAssistant) optimisticAssistant.error = message;
        new Notice(message);
        this.renderMessages();
      }
    } finally {
      this.generationAbort = undefined;
      this.sendButton.setText("发送");
      this.renderConnection();
    }
  }

  private stopGeneration(): void {
    this.generationAbort?.abort();
  }

  private async loadSession(id: string): Promise<void> {
    try {
      this.currentSessionID = id;
      await this.plugin.setCurrentSession(id);
      this.messages = await this.plugin.getMessages(id);
      this.historyMode = false;
      const session = (await this.plugin.listSessions()).find((item) => item.id === id);
      const resolvedAgent = this.plugin.sessionAgent(id);
      if (session?.agentID && session.agentID !== resolvedAgent?.id) {
        const manualModelID = session.modelSource === "manual" && this.plugin.modelByID(session.modelID)?.enabled
          ? session.modelID
          : undefined;
        await this.plugin.setSessionAgent(id, resolvedAgent?.id);
        if (manualModelID) await this.plugin.setSessionModel(id, manualModelID);
        new Notice(`原会话 Agent 已不可用，已切换为“${resolvedAgent?.name ?? "基础聊天"}”`);
      }
      this.renderHeaderTitle(session?.title ?? "会话");
      this.renderAgentOptions();
      this.renderModelOptions();
      this.renderMessages();
    } catch (error) {
      new Notice(this.plugin.errorMessage(error));
      this.renderMessages();
    }
  }

  private async showHistory(): Promise<void> {
    try {
      this.sessions = await this.plugin.listSessions();
      this.historyMode = true;
      this.renderHistory("");
    } catch (error) {
      new Notice(this.plugin.errorMessage(error));
      this.renderMessages();
    }
  }

  private renderHistory(query: string): void {
    this.composerEl.addClass("is-hidden");
    this.bodyEl.empty();
    const top = this.bodyEl.createDiv({ cls: "wc-history-top" });
    const back = this.iconButton(top, "arrow-left", "返回当前会话", () => {
      this.historyMode = false;
      this.renderMessages();
    });
    back.addClass("wc-history-back");
    top.createEl("h3", { text: "会话记录" });
    const search = this.bodyEl.createEl("input", {
      cls: "wc-history-search",
      attr: { type: "search", placeholder: "搜索会话", value: query }
    });
    search.addEventListener("input", () => this.renderHistory(search.value));
    window.setTimeout(() => {
      search.focus();
      search.setSelectionRange(query.length, query.length);
    }, 0);
    const list = this.bodyEl.createDiv({ cls: "wc-history-list" });
    const normalized = query.trim().toLocaleLowerCase();
    const sessions = this.sessions.filter((session) => session.title.toLocaleLowerCase().includes(normalized));
    if (sessions.length === 0) {
      const empty = list.createDiv({ cls: "wc-empty" });
      empty.createDiv({ text: query ? "没有找到相关会话" : "还没有会话记录" });
      this.textButton(empty, "新建会话", () => void this.newSession());
      return;
    }
    let lastGroup = "";
    for (const session of sessions) {
      const group = dateGroup(session.updatedAt);
      if (group !== lastGroup) {
        list.createDiv({ cls: "wc-history-group", text: group });
        lastGroup = group;
      }
      const row = list.createDiv({ cls: `wc-session-row${session.id === this.currentSessionID ? " is-active" : ""}` });
      const main = row.createDiv({ cls: "wc-session-main" });
      main.createDiv({ cls: "wc-session-title", text: session.title });
      main.createDiv({ cls: "wc-session-meta", text: `${formatTime(session.updatedAt)} · ${statusLabel(session.status)}` });
      main.addEventListener("click", () => void this.loadSession(session.id));
      const menu = this.iconButton(row, "ellipsis", "会话操作", (event) => this.showSessionMenu(event, session));
      menu.addClass("wc-session-menu");
    }
  }

  private showSessionMenu(event: MouseEvent, session: ChatSessionSummary): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("重命名").setIcon("pencil").onClick(() => this.renameSession(session)));
    menu.addItem((item) => item.setTitle("删除").setIcon("trash").onClick(() => this.confirmDeleteSession(session)));
    menu.showAtMouseEvent(event);
  }

  private showCurrentSessionMenu(event: MouseEvent): void {
    const menu = new Menu();
    if (this.currentSessionID) {
      menu.addItem((item) => item.setTitle("重命名当前会话").setIcon("pencil").onClick(() => {
        const current = this.sessions.find((session) => session.id === this.currentSessionID) ?? {
          id: this.currentSessionID!, title: this.currentTitle(), createdAt: 0, updatedAt: 0, status: "idle" as const
        };
        this.renameSession(current);
      }));
      if (this.generationAbort) menu.addItem((item) => item.setTitle("停止生成").setIcon("square").onClick(() => this.stopGeneration()));
      menu.addSeparator();
      menu.addItem((item) => item.setTitle("删除当前会话").setIcon("trash").onClick(() => {
        const current = this.sessions.find((session) => session.id === this.currentSessionID) ?? {
          id: this.currentSessionID!, title: this.currentTitle(), createdAt: 0, updatedAt: 0, status: "idle" as const
        };
        this.confirmDeleteSession(current);
      }));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("复制运行诊断").setIcon("copy").onClick(() => {
      void navigator.clipboard.writeText(this.plugin.diagnosticText());
      new Notice("已复制运行诊断");
    }));
    menu.showAtMouseEvent(event);
  }

  private renameSession(session: ChatSessionSummary): void {
    new TextInputModal(this.app, "重命名会话", session.title, async (title) => {
      await this.plugin.renameSession(session.id, title);
      this.renderHeaderTitle(title);
      if (this.historyMode) await this.showHistory();
    }).open();
  }

  private confirmDeleteSession(session: ChatSessionSummary): void {
    new ConfirmModal(this.app, `删除“${session.title}”？`, "删除后无法恢复。", async () => {
      await this.plugin.deleteSession(session.id);
      if (this.currentSessionID === session.id) {
        this.currentSessionID = undefined;
        this.messages = [];
        await this.plugin.setCurrentSession(undefined);
        this.renderHeaderTitle("新对话");
        this.resetContexts();
        this.renderAgentOptions();
        this.renderModelOptions();
      }
      await this.plugin.savePluginData();
      if (this.historyMode) await this.showHistory();
      else this.renderMessages();
    }).open();
  }

  private renderMessages(): void {
    if (this.historyMode) return;
    this.composerEl.removeClass("is-hidden");
    this.bodyEl.empty();
    if (this.plugin.runtime.status === "error" || this.plugin.runtime.status === "missing-model") this.renderConnectionErrorCard();
    if (this.messages.length === 0) {
      const empty = this.bodyEl.createDiv({ cls: "wc-empty wc-chat-empty" });
      empty.createDiv({ cls: "wc-empty-icon", text: "✦" });
      empty.createEl("h3", { text: "围绕当前稿件开始对话" });
      empty.createDiv({ text: this.contexts.some((chip) => chip.followsActiveNote)
        ? "当前页面已在输入框中，你也可以添加更多文档。"
        : "可以从输入框左下角添加当前页面或其他文档。" });
      return;
    }
    for (const message of this.messages) {
      const item = this.bodyEl.createDiv({ cls: `wc-message is-${message.role}` });
      item.createDiv({ cls: "wc-message-role", text: message.role === "user" ? "你" : "Copilot" });
      const content = item.createDiv({ cls: "wc-message-content" });
      if (message.text) void MarkdownRenderer.render(this.app, message.text, content, "", this);
      else if (!message.error) content.createDiv({ cls: "wc-typing", text: "正在思考…" });
      if (message.error) item.createDiv({ cls: "wc-message-error", text: friendlyError(message.error) });
      if (message.role === "assistant" && message.text) {
        const actions = item.createDiv({ cls: "wc-message-actions" });
        this.iconButton(actions, "copy", "复制", () => void navigator.clipboard.writeText(message.text));
        this.iconButton(actions, "text-cursor-input", "插入光标", () => this.insertAtCursor(message.text));
      }
    }
    this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
  }

  private renderConnectionErrorCard(): void {
    if (this.plugin.runtime.status !== "error" && this.plugin.runtime.status !== "missing-model") return;
    const state = this.plugin.runtime;
    const card = this.bodyEl.createDiv({ cls: "wc-error-card" });
    card.createEl("h3", { text: state.status === "missing-model" ? "还没有可用模型" : "模型请求失败" });
    card.createDiv({ cls: "wc-error-reason", text: state.message });
    card.createDiv({ cls: "wc-error-hint", text: "请在 Obsidian 设置 → Writer Copilot 中添加提供商、API Key 和模型。" });
    const actions = card.createDiv({ cls: "wc-error-actions" });
    const configure = actions.createEl("button", { text: "打开模型设置", cls: "mod-cta" });
    configure.addEventListener("click", () => this.plugin.openSettings());
    const diagnostic = actions.createEl("button", { text: "复制诊断" });
    diagnostic.addEventListener("click", () => {
      void navigator.clipboard.writeText(this.plugin.diagnosticText());
      new Notice("已复制连接诊断");
    });
  }

  private insertAtCursor(text: string): void {
    const bundle = this.plugin.contextService.getParagraphBundle();
    if (!bundle) {
      new Notice("当前没有可写入的 Markdown 编辑器");
      return;
    }
    const result = this.plugin.editorService.apply(bundle.snapshot, text, "insert-cursor");
    new Notice(result.ok ? "已插入，可使用 Obsidian 撤销" : "光标或文件已变化，未写入");
  }

  private showContextMenu(event: MouseEvent): void {
    const menu = new Menu();
    const hasCurrent = this.contexts.some((chip) => chip.followsActiveNote);
    menu.addItem((item) => item
      .setTitle(hasCurrent ? "移除当前页面" : "添加当前页面")
      .setIcon("file-text")
      .setChecked(hasCurrent)
      .onClick(() => {
        if (hasCurrent) {
          this.currentNoteRemoved = true;
          this.contexts = this.contexts.filter((chip) => !chip.followsActiveNote);
          this.renderContexts();
        } else {
          this.currentNoteRemoved = false;
          void this.attachCurrentNote();
        }
      }));
    menu.addItem((item) => item.setTitle("添加当前选区").setIcon("text-select").onClick(() => this.attachSelection()));
    menu.addItem((item) => item.setTitle("添加当前段落").setIcon("pilcrow").onClick(() => this.attachParagraph()));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("选择其他文档…").setIcon("files").onClick(() => this.openNotePicker()));
    menu.showAtMouseEvent(event);
  }

  private attachSelection(): void {
    const bundle = this.plugin.contextService.getSelectionBundle();
    if (!bundle) {
      new Notice("请先在 Markdown 编辑器中选择文字");
      return;
    }
    this.addContexts(bundle.chips);
  }

  private attachParagraph(): void {
    const bundle = this.plugin.contextService.getParagraphBundle();
    if (!bundle) {
      new Notice("当前没有可用段落");
      return;
    }
    this.addContexts(bundle.chips);
  }

  private async attachCurrentNote(): Promise<void> {
    const file = this.resolveCurrentFile();
    if (!file) return;
    const note = await this.plugin.contextService.getNoteChip(file);
    this.addContexts([{ ...note, id: "current-note", label: `当前页面：${file.basename}`, followsActiveNote: true }]);
  }

  private openNotePicker(): void {
    const selected = this.contexts.filter((chip) => chip.type === "note" && !chip.followsActiveNote).map((chip) => chip.filePath);
    new NotePickerModal(this.app, this.plugin.contextService.listMarkdownNotes(), selected, (files) => {
      void this.replaceManualNotes(files);
    }).open();
  }

  private async replaceManualNotes(files: TFile[]): Promise<void> {
    const activePath = this.contexts.find((chip) => chip.followsActiveNote)?.filePath;
    const notes = await Promise.all(files.filter((file) => file.path !== activePath).map((file) => this.plugin.contextService.getNoteChip(file)));
    this.contexts = this.contexts.filter((chip) => chip.type !== "note" || chip.followsActiveNote);
    this.addContexts(notes);
  }

  private addContexts(chips: ContextChip[]): void {
    for (const chip of chips) {
      const index = this.contexts.findIndex((item) => item.id === chip.id);
      if (index >= 0) this.contexts[index] = chip;
      else this.contexts.push(chip);
    }
    this.renderContexts();
  }

  private resetContexts(): void {
    this.contexts = [];
    this.currentNoteRemoved = false;
    if (this.plugin.settings.attachCurrentNoteByDefault) void this.attachCurrentNote();
    else this.renderContexts();
  }

  private async refreshFollowingCurrentNote(): Promise<void> {
    if (this.currentNoteRemoved) return;
    if (!this.contexts.some((chip) => chip.followsActiveNote)) {
      if (this.plugin.settings.attachCurrentNoteByDefault) await this.attachCurrentNote();
      return;
    }
    const file = this.resolveCurrentFile();
    if (!file) {
      this.contexts = this.contexts.filter((item) => !item.followsActiveNote);
      this.renderContexts();
      return;
    }
    this.contexts = this.contexts.filter((item) => item.followsActiveNote || item.filePath !== file.path);
    await this.attachCurrentNote();
  }

  private async refreshNoteContexts(): Promise<void> {
    await this.refreshFollowingCurrentNote();
    const updated: ContextChip[] = [];
    for (const chip of this.contexts) {
      if (chip.type !== "note" || chip.followsActiveNote) {
        updated.push(chip);
        continue;
      }
      const file = this.app.vault.getAbstractFileByPath(chip.filePath);
      if (file instanceof TFile) updated.push(await this.plugin.contextService.getNoteChip(file));
    }
    this.contexts = updated;
    this.renderContexts();
  }

  private renderContexts(): void {
    this.contextEl.empty();
    for (const chip of this.contexts) {
      const element = this.contextEl.createDiv({ cls: "wc-context-chip" });
      element.createSpan({ text: chip.label, attr: { title: chip.filePath } });
      const remove = element.createEl("button", { attr: { "aria-label": `移除${chip.label}` } });
      setIcon(remove, "x");
      remove.addEventListener("click", () => {
        if (chip.followsActiveNote) this.currentNoteRemoved = true;
        this.contexts = this.contexts.filter((item) => item.id !== chip.id);
        this.renderContexts();
      });
    }
  }

  private renderConnection(): void {
    const state = this.plugin.runtime;
    this.footerEl.empty();
    const dot = this.footerEl.createSpan({ cls: `wc-status-dot is-${state.status}` });
    dot.setAttr("aria-hidden", "true");
    if (state.status === "ready") {
      const agent = this.plugin.sessionAgent(this.currentSessionID);
      this.footerEl.createSpan({ text: `模型就绪 · ${agent?.name ?? "基础聊天"}` });
      this.headerMetaEl.setText(agent?.name ?? "模型就绪");
    } else if (state.status === "error") {
      this.footerEl.createSpan({ text: state.message });
      this.headerMetaEl.setText("连接失败");
    } else {
      this.footerEl.createSpan({ text: state.message });
      this.headerMetaEl.setText(state.status === "generating" ? "正在生成" : "需要配置模型");
    }
  }

  private renderAgentOptions(): void {
    if (!this.agentSelect) return;
    const current = this.plugin.sessionAgent(this.currentSessionID);
    this.agentSelect.empty();
    if (!this.plugin.enabledAgents.length) {
      this.agentSelect.createEl("option", { text: "基础聊天", value: "" });
    }
    for (const agent of this.plugin.enabledAgents) {
      const suffix = agent.id === this.plugin.settings.defaultAgentID ? " · 默认" : "";
      this.agentSelect.createEl("option", { text: `${agent.name}${suffix}`, value: agent.id });
    }
    this.agentSelect.value = current?.id ?? "";
    this.agentSelect.disabled = this.plugin.enabledAgents.length === 0;
    this.agentSelect.title = current?.description || "当前会话 Agent";
  }

  private renderModelOptions(): void {
    if (!this.modelSelect) return;
    const current = this.plugin.sessionModel(this.currentSessionID);
    this.modelSelect.empty();
    if (!this.plugin.models.length) this.modelSelect.createEl("option", { text: "请先配置模型", value: "" });
    for (const model of this.plugin.models) {
      this.modelSelect.createEl("option", { text: model.label, value: model.id });
    }
    this.modelSelect.value = current?.id ?? this.plugin.models[0]?.id ?? "";
    this.modelSelect.disabled = this.plugin.models.length === 0;
  }

  private async changeModel(): Promise<void> {
    const modelID = this.modelSelect.value || undefined;
    try {
      if (!this.currentSessionID) await this.newSession();
      if (this.currentSessionID) await this.plugin.setSessionModel(this.currentSessionID, modelID);
    } catch (error) {
      new Notice(this.plugin.errorMessage(error));
      this.renderModelOptions();
    }
  }

  private async changeAgent(): Promise<void> {
    const agentID = this.agentSelect.value || undefined;
    try {
      if (!this.currentSessionID) await this.newSession();
      if (!this.currentSessionID) return;
      const agent = await this.plugin.setSessionAgent(this.currentSessionID, agentID);
      this.renderAgentOptions();
      this.renderModelOptions();
      this.renderConnection();
      if (agent) new Notice(`已切换到“${agent.name}”`);
    } catch (error) {
      new Notice(this.plugin.errorMessage(error));
      this.renderAgentOptions();
      this.renderModelOptions();
    }
  }

  private renderHeaderTitle(title: string): void {
    this.contentEl.querySelector<HTMLElement>("[data-role='session-title']")?.setText(title);
  }

  private currentTitle(): string {
    return this.contentEl.querySelector<HTMLElement>("[data-role='session-title']")?.textContent?.trim() || "新对话";
  }

  private iconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    handler: (event: MouseEvent) => void
  ): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label, title: label } });
    setIcon(button, icon);
    button.addEventListener("click", handler);
    return button;
  }

  private textButton(parent: HTMLElement, label: string, handler: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { text: label, cls: "wc-text-button" });
    button.addEventListener("click", handler);
    return button;
  }

  private scheduleDraftSave(): void {
    if (this.draftSaveTimer) window.clearTimeout(this.draftSaveTimer);
    this.draftSaveTimer = window.setTimeout(() => void this.plugin.setDraft(this.inputEl.value), 350);
  }

  private resolveCurrentFile(): TFile | undefined {
    const active = this.app.workspace.getActiveFile();
    if (active) return active;
    if (this.currentFile) return this.currentFile;
    for (const path of this.app.workspace.getLastOpenFiles()) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile && file.extension === "md") return file;
    }
    return undefined;
  }
}

class TextInputModal extends Modal {
  constructor(
    app: WriterCopilotPlugin["app"],
    private readonly heading: string,
    private readonly initialValue: string,
    private readonly onSubmit: (value: string) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.heading);
    const input = this.contentEl.createEl("input", { attr: { type: "text", value: this.initialValue } });
    input.addClass("wc-dialog-input");
    const actions = this.contentEl.createDiv({ cls: "wc-dialog-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());
    const confirm = actions.createEl("button", { text: "保存", cls: "mod-cta" });
    const submit = async () => {
      const value = input.value.trim();
      if (!value) return;
      try {
        await this.onSubmit(value);
        this.close();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "保存失败");
      }
    };
    confirm.addEventListener("click", () => void submit());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) void submit();
    });
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class ConfirmModal extends Modal {
  constructor(
    app: WriterCopilotPlugin["app"],
    private readonly heading: string,
    private readonly description: string,
    private readonly onConfirm: () => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.heading);
    this.contentEl.createEl("p", { text: this.description });
    const actions = this.contentEl.createDiv({ cls: "wc-dialog-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());
    const confirm = actions.createEl("button", { text: "删除", cls: "mod-warning" });
    confirm.addEventListener("click", () => void this.onConfirm().then(() => this.close()).catch((error) => {
      new Notice(error instanceof Error ? error.message : "删除失败");
    }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function friendlyError(message: string): string {
  if (message.includes("Failed to fetch")) return "无法连接模型服务，请检查网络、API Key 和服务地址";
  return message;
}

function dateGroup(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.floor((startToday - startDate) / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return "最近 7 天";
  if (days < 30) return "最近 30 天";
  return "更早";
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function statusLabel(status: ChatSessionSummary["status"]): string {
  if (status === "generating") return "生成中";
  if (status === "stopped") return "已停止";
  if (status === "error") return "生成失败";
  return "已保存";
}
