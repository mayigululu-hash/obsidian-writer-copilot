import { Modal, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import type WriterCopilotPlugin from "../main";
import { createProviderProfile } from "../settings";
import type { AgentProfile, ModelOption, ProviderKind, ProviderProfile, WritingActionDefinition, WritingActionScope } from "../types";
import type { WritingActionInput } from "../writing/action-service";

type SettingsTabID = "basic" | "models" | "agents" | "writing" | "sessions" | "advanced";

const SETTINGS_TABS: Array<{ id: SettingsTabID; label: string; icon: string }> = [
  { id: "basic", label: "基础", icon: "settings-2" },
  { id: "models", label: "模型", icon: "bot" },
  { id: "agents", label: "Agent", icon: "user-round-cog" },
  { id: "writing", label: "写作", icon: "pen-line" },
  { id: "sessions", label: "会话", icon: "messages-square" },
  { id: "advanced", label: "高级", icon: "wrench" }
];

export class WriterCopilotSettingsTab extends PluginSettingTab {
  private activeTab: SettingsTabID = "basic";
  private newProviderKind: ProviderKind = "openai-compatible";
  private selectedProfileID?: string;
  private selectedAgentID?: string;

  constructor(private readonly plugin: WriterCopilotPlugin) {
    super(plugin.app, plugin);
  }

  show(tab: SettingsTabID): void {
    this.activeTab = tab;
    this.display();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("wc-settings-root");
    this.renderHeader(containerEl);
    this.renderTabs(containerEl);
    const panel = containerEl.createDiv({ cls: "wc-settings-panel" });
    if (this.activeTab === "basic") this.renderBasic(panel);
    else if (this.activeTab === "models") this.renderModels(panel);
    else if (this.activeTab === "agents") this.renderAgents(panel);
    else if (this.activeTab === "writing") this.renderWriting(panel);
    else if (this.activeTab === "sessions") this.renderSessions(panel);
    else this.renderAdvanced(panel);
  }

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: "wc-settings-header" });
    const title = header.createDiv({ cls: "wc-settings-title-line" });
    title.createEl("h1", { text: "Writer Copilot 设置" });
    title.createSpan({ text: `v${this.plugin.manifest.version}`, cls: "wc-settings-version" });
    title.createSpan({
      text: this.plugin.models.length ? "模型就绪" : "等待配置模型",
      cls: `wc-settings-status ${this.plugin.models.length ? "is-ready" : "is-pending"}`
    });
    const reset = header.createEl("button", { text: "重置设置", cls: "wc-settings-reset" });
    reset.addEventListener("click", () => this.confirmReset());
  }

  private renderTabs(container: HTMLElement): void {
    const tabs = container.createDiv({ cls: "wc-settings-tabs", attr: { role: "tablist" } });
    for (const item of SETTINGS_TABS) {
      const tab = tabs.createEl("button", {
        cls: `wc-settings-tab ${this.activeTab === item.id ? "is-active" : ""}`,
        attr: { type: "button", role: "tab", "aria-selected": String(this.activeTab === item.id) }
      });
      const icon = tab.createSpan({ cls: "wc-settings-tab-icon" });
      setIcon(icon, item.icon);
      tab.createSpan({ text: item.label });
      tab.addEventListener("click", () => {
        this.activeTab = item.id;
        this.display();
      });
    }
  }

  private renderBasic(panel: HTMLElement): void {
    const highlight = panel.createDiv({ cls: "wc-settings-highlight" });
    const copy = highlight.createDiv({ cls: "wc-settings-highlight-copy" });
    copy.createEl("h2", { text: "模型配置状态" });
    copy.createEl("p", {
      text: this.plugin.models.length
        ? `当前有 ${this.plugin.models.length} 个可用模型，插件会直接调用模型服务，不依赖 OpenCode。`
        : "添加模型服务并配置 API Key 后，就可以在侧边栏聊天和文中写作中使用。"
    });
    const action = highlight.createEl("button", { text: this.plugin.models.length ? "管理模型" : "开始配置", cls: "mod-cta" });
    action.addEventListener("click", () => {
      this.activeTab = "models";
      this.display();
    });

    this.renderSectionHeading(panel, "常规", "配置默认模型和插件打开方式。所有设置会自动保存。");
    new Setting(panel)
      .setName("API Keys")
      .setDesc("为 OpenAI 兼容、Anthropic 或 Google Gemini 服务配置密钥")
      .addButton((button) => button.setButtonText("设置密钥").onClick(() => {
        this.activeTab = "models";
        this.display();
      }));
    new Setting(panel).setName("默认聊天模型").setDesc("侧边栏新会话默认使用的模型").addDropdown((dropdown) => {
      addModelOptions(dropdown, this.plugin.models, this.plugin.settings.chatModelID);
      dropdown.onChange(async (value) => {
        this.plugin.settings.chatModelID = value || undefined;
        await this.plugin.savePluginData();
      });
    });
    new Setting(panel).setName("默认写作模型").setDesc("改写、压缩和续写使用；留空时跟随聊天模型").addDropdown((dropdown) => {
      addModelOptions(dropdown, this.plugin.models, this.plugin.settings.inlineModelID, "跟随聊天模型");
      dropdown.onChange(async (value) => {
        this.plugin.settings.inlineModelID = value || undefined;
        await this.plugin.savePluginData();
      });
    });
    new Setting(panel).setName("插件打开位置").setDesc("点击功能区图标时打开的默认侧边栏").addDropdown((dropdown) => dropdown
      .addOption("right", "右侧边栏")
      .addOption("left", "左侧边栏")
      .setValue(this.plugin.settings.sidebarPosition)
      .onChange(async (value) => {
        this.plugin.settings.sidebarPosition = value === "left" ? "left" : "right";
        await this.plugin.savePluginData();
      }));
  }

  private renderModels(panel: HTMLElement): void {
    this.renderSectionHeading(panel, "模型服务", "插件直接请求你配置的模型服务。API Key 保存在 Obsidian SecretStorage 中。");
    const addStrip = panel.createDiv({ cls: "wc-provider-add" });
    const addCopy = addStrip.createDiv();
    addCopy.createEl("strong", { text: "添加提供商" });
    addCopy.createEl("div", { text: "中转服务和本地模型请选择 OpenAI 兼容", cls: "setting-item-description" });
    const controls = addStrip.createDiv({ cls: "wc-provider-add-controls" });
    const select = controls.createEl("select", { cls: "dropdown" });
    for (const [value, label] of [["openai-compatible", "OpenAI 兼容"], ["anthropic", "Anthropic"], ["gemini", "Google Gemini"]] as Array<[ProviderKind, string]>) {
      select.createEl("option", { value, text: label });
    }
    select.value = this.newProviderKind;
    select.addEventListener("change", () => { this.newProviderKind = select.value as ProviderKind; });
    const add = controls.createEl("button", { text: "添加", cls: "mod-cta" });
    add.addEventListener("click", () => void this.addProvider());

    const profiles = this.plugin.settings.profiles;
    if (!profiles.length) {
      const empty = panel.createDiv({ cls: "wc-settings-empty" });
      const icon = empty.createDiv({ cls: "wc-settings-empty-icon" });
      setIcon(icon, "plug-zap");
      empty.createEl("strong", { text: "还没有模型服务" });
      empty.createEl("p", { text: "先在上方选择服务类型并添加，然后填写地址与 API Key。" });
      return;
    }

    if (!profiles.some((profile) => profile.id === this.selectedProfileID)) this.selectedProfileID = profiles[0].id;
    const providerTabs = panel.createDiv({ cls: "wc-provider-tabs" });
    for (const profile of profiles) {
      const tab = providerTabs.createEl("button", {
        text: profile.name,
        cls: `wc-provider-tab ${profile.id === this.selectedProfileID ? "is-active" : ""}`
      });
      tab.addEventListener("click", () => {
        this.selectedProfileID = profile.id;
        this.display();
      });
    }
    const selected = profiles.find((profile) => profile.id === this.selectedProfileID);
    if (selected) this.renderProfile(panel, selected);
  }

  private renderWriting(panel: HTMLElement): void {
    this.renderSectionHeading(panel, "写作与输入", "配置聊天输入习惯、文中动作和系统指令。所有写作动作都可以编辑或删除。");
    new Setting(panel).setName("聊天默认附加当前笔记").setDesc("打开侧边栏时，将当前页面作为默认上下文").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.attachCurrentNoteByDefault).onChange(async (value) => {
        this.plugin.settings.attachCurrentNoteByDefault = value;
        await this.plugin.savePluginData();
      })
    );
    new Setting(panel).setName("回车发送").setDesc("关闭后使用 Cmd/Ctrl + Enter 发送").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.enterToSend).onChange(async (value) => {
        this.plugin.settings.enterToSend = value;
        await this.plugin.savePluginData();
      })
    );

    this.renderSectionHeading(panel, "文中写作动作", "选中文字后打开动作菜单；在空白行输入 / 可以续写。默认动作只排在首位，不会自动执行。");
    new Setting(panel).setName("空白行 / 菜单").setDesc("只在空白行输入 / 时显示续写动作").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.slashCommandsEnabled).onChange(async (value) => {
        this.plugin.settings.slashCommandsEnabled = value;
        await this.plugin.savePluginData();
      })
    );
    new Setting(panel).setName("选区默认动作").setDesc("可留空；仅控制动作菜单排序").addDropdown((dropdown) => {
      addWritingActionOptions(dropdown, this.plugin.writingActionService.list("selection", true), this.plugin.settings.defaultSelectionActionID);
      dropdown.onChange(async (value) => {
        this.plugin.writingActionService.setDefault("selection", value || undefined);
        await this.plugin.savePluginData();
        this.display();
      });
    });
    new Setting(panel).setName("空白行默认动作").setDesc("可留空；仅控制 / 菜单排序").addDropdown((dropdown) => {
      addWritingActionOptions(dropdown, this.plugin.writingActionService.list("cursor", true), this.plugin.settings.defaultCursorActionID);
      dropdown.onChange(async (value) => {
        this.plugin.writingActionService.setDefault("cursor", value || undefined);
        await this.plugin.savePluginData();
        this.display();
      });
    });

    const addStrip = panel.createDiv({ cls: "wc-writing-action-add" });
    const addCopy = addStrip.createDiv();
    addCopy.createEl("strong", { text: "写作动作" });
    addCopy.createDiv({ text: "名称、指令、适用位置、顺序均由你配置", cls: "setting-item-description" });
    const addAction = addStrip.createEl("button", { text: "新建动作", cls: "mod-cta" });
    addAction.addEventListener("click", () => this.openWritingActionEditor());

    const actions = this.plugin.writingActionService.list();
    if (!actions.length) {
      const empty = panel.createDiv({ cls: "wc-settings-empty is-compact" });
      empty.createEl("strong", { text: "还没有写作动作" });
      empty.createEl("p", { text: "你仍可在动作菜单中使用“按要求生成”，也可以新建常用动作。" });
    }
    for (const [index, action] of actions.entries()) this.renderWritingAction(panel, action, index, actions.length);

    this.renderSectionHeading(panel, "系统指令", "分别控制侧边栏聊天和文中写作的全局行为。");
    const chatPromptSetting = new Setting(panel).setName("聊天系统指令").setDesc("应用于侧边栏中的每次对话").addTextArea((input) => {
      input.inputEl.rows = 6;
      input.inputEl.addClass("wc-settings-prompt");
      input.setValue(this.plugin.settings.chatSystemInstruction).onChange(async (value) => {
        this.plugin.settings.chatSystemInstruction = value;
        await this.plugin.savePluginData();
      });
    });
    chatPromptSetting.settingEl.addClass("wc-prompt-setting");
    const inlinePromptSetting = new Setting(panel).setName("文中写作系统指令").setDesc("应用于改写、压缩、续写等动作").addTextArea((input) => {
      input.inputEl.rows = 6;
      input.inputEl.addClass("wc-settings-prompt");
      input.setValue(this.plugin.settings.inlineSystemInstruction).onChange(async (value) => {
        this.plugin.settings.inlineSystemInstruction = value;
        await this.plugin.savePluginData();
      });
    });
    inlinePromptSetting.settingEl.addClass("wc-prompt-setting");
  }

  private renderWritingAction(container: HTMLElement, action: WritingActionDefinition, index: number, total: number): void {
    const defaults: string[] = [];
    if (action.id === this.plugin.settings.defaultSelectionActionID) defaults.push("选区默认");
    if (action.id === this.plugin.settings.defaultCursorActionID) defaults.push("空白行默认");
    const description = [action.description || action.instruction, scopeLabel(action.scope), ...defaults].filter(Boolean).join(" · ");
    const setting = new Setting(container).setName(action.name).setDesc(description);
    setting.addToggle((toggle) => toggle.setTooltip("启用动作").setValue(action.enabled).onChange(async (value) => {
      this.plugin.writingActionService.setEnabled(action.id, value);
      await this.plugin.savePluginData();
      this.display();
    }));
    setting.addExtraButton((button) => button.setIcon("arrow-up").setTooltip("上移").setDisabled(index === 0).onClick(async () => {
      this.plugin.writingActionService.move(action.id, -1);
      await this.plugin.savePluginData();
      this.display();
    }));
    setting.addExtraButton((button) => button.setIcon("arrow-down").setTooltip("下移").setDisabled(index === total - 1).onClick(async () => {
      this.plugin.writingActionService.move(action.id, 1);
      await this.plugin.savePluginData();
      this.display();
    }));
    setting.addExtraButton((button) => button.setIcon("pencil").setTooltip("编辑").onClick(() => this.openWritingActionEditor(action)));
    setting.addExtraButton((button) => button.setIcon("trash").setTooltip("删除").onClick(() => this.confirmDeleteWritingAction(action)));
  }

  private openWritingActionEditor(action?: WritingActionDefinition): void {
    new WritingActionEditorModal(this.plugin, action, async (input) => {
      if (action) this.plugin.writingActionService.update(action.id, input);
      else this.plugin.writingActionService.create(input);
      await this.plugin.savePluginData();
      this.display();
    }).open();
  }

  private confirmDeleteWritingAction(action: WritingActionDefinition): void {
    new ConfirmSettingsActionModal(
      this.plugin,
      `删除“${action.name}”？`,
      "动作会从选区菜单和 / 菜单中移除；如果它是默认动作，对应默认设置会自动清空。",
      "确认删除",
      async () => {
        this.plugin.writingActionService.delete(action.id);
        await this.plugin.savePluginData();
        new Notice("写作动作已删除");
        this.display();
      }
    ).open();
  }

  private renderAgents(panel: HTMLElement): void {
    this.renderSectionHeading(
      panel,
      "Agent",
      "为不同写作任务保存默认模型与 System Instruction。Agent 只影响侧边栏聊天。"
    );

    const addStrip = panel.createDiv({ cls: "wc-provider-add wc-agent-add" });
    const addCopy = addStrip.createDiv();
    addCopy.createEl("strong", { text: "创建 Agent" });
    addCopy.createEl("div", {
      text: "创建后可配置名称、说明、默认模型和系统指令",
      cls: "setting-item-description"
    });
    const add = addStrip.createEl("button", { text: "新建 Agent", cls: "mod-cta" });
    add.addEventListener("click", () => void this.addAgent(add));

    const agents = this.plugin.agents;
    if (!agents.length) {
      const empty = panel.createDiv({ cls: "wc-settings-empty" });
      const icon = empty.createDiv({ cls: "wc-settings-empty-icon" });
      setIcon(icon, "user-round-cog");
      empty.createEl("strong", { text: "还没有 Agent" });
      empty.createEl("p", { text: "创建一个 Agent 后，就能在侧边栏会话中选择。" });
      return;
    }

    if (!agents.some((agent) => agent.id === this.selectedAgentID)) {
      this.selectedAgentID = this.plugin.settings.defaultAgentID ?? agents[0].id;
    }
    const tabs = panel.createDiv({ cls: "wc-provider-tabs wc-agent-tabs" });
    for (const agent of agents) {
      const label = agent.id === this.plugin.settings.defaultAgentID ? `${agent.name} · 默认` : agent.name;
      const tab = tabs.createEl("button", {
        text: label,
        cls: `wc-provider-tab wc-agent-tab ${agent.id === this.selectedAgentID ? "is-active" : ""}${agent.enabled ? "" : " is-disabled"}`,
        attr: { type: "button" }
      });
      tab.addEventListener("click", () => {
        this.selectedAgentID = agent.id;
        this.display();
      });
    }
    const selected = agents.find((agent) => agent.id === this.selectedAgentID);
    if (selected) this.renderAgent(panel, selected);
  }

  private renderAgent(container: HTMLElement, agent: AgentProfile): void {
    const section = container.createDiv({ cls: "wc-provider-card wc-agent-card" });
    const heading = section.createDiv({ cls: "wc-provider-heading" });
    const identity = heading.createDiv();
    const title = identity.createDiv({ cls: "wc-provider-title" });
    title.createEl("h3", { text: agent.name });
    if (agent.id === this.plugin.settings.defaultAgentID) title.createSpan({ text: "默认", cls: "wc-provider-kind" });
    if (!agent.enabled) title.createSpan({ text: "已停用", cls: "wc-provider-kind is-muted" });
    identity.createDiv({
      text: agent.description || "未填写说明",
      cls: "setting-item-description"
    });

    let enabled = agent.enabled;
    let name = agent.name;
    let description = agent.description;
    let modelID = agent.modelID;
    let systemInstruction = agent.systemInstruction;

    new Setting(section).setName("启用").setDesc("停用后不会出现在侧边栏选择器中").addToggle((toggle) => {
      toggle.setValue(enabled).onChange((value) => { enabled = value; });
    });
    new Setting(section).setName("名称").setDesc("必填，最多 40 个字符").addText((input) => {
      input.inputEl.addClass("wc-settings-wide-input");
      input.setValue(name).onChange((value) => { name = value; });
    });
    new Setting(section).setName("说明").setDesc("可选，最多 120 个字符；不会发送给模型").addText((input) => {
      input.inputEl.addClass("wc-settings-wide-input");
      input.setValue(description).onChange((value) => { description = value; });
    });
    new Setting(section).setName("默认模型").setDesc("留空时跟随全局聊天模型").addDropdown((dropdown) => {
      addModelOptions(dropdown, this.plugin.models, modelID, "跟随全局聊天模型");
      dropdown.onChange((value) => { modelID = value || undefined; });
    });
    new Setting(section).setName("System Instruction").setDesc("只用于侧边栏聊天，最多 8000 个字符").addTextArea((input) => {
      input.inputEl.rows = 9;
      input.inputEl.addClass("wc-settings-prompt", "wc-agent-instruction");
      input.setValue(systemInstruction).onChange((value) => { systemInstruction = value; });
    });

    const defaultSetting = new Setting(section)
      .setName("默认 Agent")
      .setDesc("新对话会自动使用默认 Agent");
    if (agent.id === this.plugin.settings.defaultAgentID) {
      defaultSetting.addButton((button) => button.setButtonText("当前默认").setDisabled(true));
    } else {
      defaultSetting.addButton((button) => button.setButtonText("设为默认").onClick(async () => {
        try {
          await this.plugin.setDefaultAgent(agent.id);
          new Notice(`已将“${agent.name}”设为默认 Agent`);
          this.display();
        } catch (error) {
          new Notice(this.plugin.errorMessage(error));
        }
      }));
    }

    const actions = section.createDiv({ cls: "wc-agent-actions" });
    const remove = actions.createEl("button", { text: "删除", cls: "mod-warning" });
    remove.addEventListener("click", () => this.confirmDeleteAgent(agent));
    const save = actions.createEl("button", { text: "保存 Agent", cls: "mod-cta" });
    save.addEventListener("click", () => void this.saveAgent(agent, {
      name,
      description,
      modelID,
      systemInstruction,
      enabled
    }, save));
  }

  private renderSessions(panel: HTMLElement): void {
    this.renderSectionHeading(panel, "会话记录", "聊天记录保存在当前仓库的插件目录中，不会写入第三方会话服务。");
    const highlight = panel.createDiv({ cls: "wc-settings-highlight is-compact" });
    const copy = highlight.createDiv({ cls: "wc-settings-highlight-copy" });
    copy.createEl("h2", { text: "本地会话" });
    const count = copy.createEl("p", { text: "正在读取会话数量…" });
    void this.plugin.listSessions().then((sessions) => {
      if (count.isConnected) count.setText(`当前保存了 ${sessions.length} 个会话。新对话、历史切换和重命名都会自动落盘。`);
    }).catch(() => {
      if (count.isConnected) count.setText("暂时无法读取会话目录，请在高级设置中复制诊断信息。");
    });

    const sessionPath = this.sessionDirectory();
    new Setting(panel).setName("保存位置").setDesc(sessionPath).addButton((button) => button.setButtonText("复制路径").onClick(async () => {
      await navigator.clipboard.writeText(sessionPath);
      new Notice("会话目录已复制");
    }));
    new Setting(panel).setName("清空会话记录").setDesc("删除所有本地聊天记录；模型和写作设置不会受到影响").addButton((button) => button
      .setButtonText("清空全部")
      .setWarning()
      .onClick(() => this.confirmClearSessions()));
  }

  private renderAdvanced(panel: HTMLElement): void {
    this.renderSectionHeading(panel, "高级", "用于排查模型和插件运行状态。提交问题时请先复制诊断信息。");
    const diagnostic = panel.createDiv({ cls: "wc-settings-diagnostic-card" });
    const heading = diagnostic.createDiv({ cls: "wc-settings-diagnostic-heading" });
    heading.createEl("strong", { text: "运行诊断" });
    const copy = heading.createEl("button", { text: "复制诊断" });
    copy.addEventListener("click", () => void navigator.clipboard.writeText(this.plugin.diagnosticText()).then(() => new Notice("诊断信息已复制")));
    diagnostic.createEl("pre", { cls: "wc-diagnostic", text: this.plugin.diagnosticText() });
    new Setting(panel).setName("恢复默认设置").setDesc("清除模型服务、Agent 配置、默认模型和写作偏好；不会删除会话记录").addButton((button) => button
      .setButtonText("重置设置")
      .setWarning()
      .onClick(() => this.confirmReset()));
  }

  private renderProfile(container: HTMLElement, profile: ProviderProfile): void {
    const section = container.createDiv({ cls: "wc-provider-card" });
    const heading = section.createDiv({ cls: "wc-provider-heading" });
    const identity = heading.createDiv();
    const title = identity.createDiv({ cls: "wc-provider-title" });
    title.createEl("h3", { text: profile.name });
    title.createSpan({ text: providerLabel(profile.kind), cls: "wc-provider-kind" });
    identity.createDiv({ text: profile.enabled ? "服务已启用" : "服务已停用", cls: "setting-item-description" });
    const enabled = heading.createEl("input", { type: "checkbox", cls: "wc-provider-enabled" });
    enabled.checked = profile.enabled;
    enabled.addEventListener("change", () => void this.updateProfileEnabled(profile, enabled.checked));

    new Setting(section).setName("名称").setDesc("仅用于在插件中识别这个服务").addText((input) => {
      input.inputEl.addClass("wc-settings-wide-input");
      input.setValue(profile.name).onChange(async (value) => {
        profile.name = value.trim() || providerLabel(profile.kind);
        await this.plugin.savePluginData();
      });
    });
    new Setting(section).setName("服务地址").setDesc(baseURLHint(profile.kind)).addText((input) => {
      input.inputEl.addClass("wc-settings-wide-input");
      input.setValue(profile.baseURL).onChange(async (value) => {
        profile.baseURL = value.trim();
        await this.plugin.savePluginData();
      });
    });
    new Setting(section).setName("API Key").setDesc(this.plugin.hasSecret(profile.secretID) ? "已安全保存；留空不会覆盖" : "将保存到 Obsidian SecretStorage").addText((input) => {
      input.inputEl.type = "password";
      input.inputEl.addClass("wc-settings-wide-input");
      input.inputEl.placeholder = this.plugin.hasSecret(profile.secretID) ? "已配置" : "输入 API Key";
      input.onChange((value) => { if (value.trim()) this.plugin.setSecret(profile.secretID, value); });
    });

    const modelHeading = section.createDiv({ cls: "wc-provider-model-heading" });
    const modelCopy = modelHeading.createDiv();
    modelCopy.createEl("strong", { text: "模型" });
    modelCopy.createDiv({ text: "同步服务提供的模型，或手动添加模型 ID", cls: "setting-item-description" });
    const actions = modelHeading.createDiv({ cls: "wc-provider-actions" });
    const sync = actions.createEl("button", { text: "从接口同步" });
    sync.addEventListener("click", () => void this.syncModels(profile, sync));
    const test = actions.createEl("button", { text: "测试连接" });
    test.addEventListener("click", () => void this.testProfile(profile, test));

    const models = this.plugin.settings.models.filter((item) => item.profileID === profile.id);
    if (!models.length) section.createDiv({ cls: "wc-model-empty", text: "尚未添加模型。连接服务后点击“从接口同步”。" });
    for (const model of models) {
      new Setting(section)
        .setName(model.label)
        .setDesc(model.providerModelID)
        .addToggle((toggle) => toggle.setValue(model.enabled).onChange(async (value) => {
          model.enabled = value;
          await this.plugin.savePluginData();
          this.display();
        }))
        .addExtraButton((button) => button.setIcon("trash").setTooltip("删除模型").onClick(async () => {
          this.plugin.settings.models = this.plugin.settings.models.filter((item) => item.id !== model.id);
          if (this.plugin.settings.chatModelID === model.id) this.plugin.settings.chatModelID = undefined;
          if (this.plugin.settings.inlineModelID === model.id) this.plugin.settings.inlineModelID = undefined;
          await this.plugin.savePluginData();
          this.display();
        }));
    }

    const manual = new Setting(section).setName("手动添加模型").setDesc("兼容服务不支持模型列表时使用");
    let modelID = "";
    let label = "";
    manual.addText((input) => input.setPlaceholder("模型 ID").onChange((value) => { modelID = value.trim(); }));
    manual.addText((input) => input.setPlaceholder("显示名称（可选）").onChange((value) => { label = value.trim(); }));
    manual.addButton((button) => button.setButtonText("添加").onClick(async () => {
      if (!modelID) {
        new Notice("请输入模型 ID");
        return;
      }
      this.addModels(profile, [{ id: modelID, label: label || modelID }]);
      await this.plugin.savePluginData();
      this.display();
    }));

    new Setting(section).setName("删除提供商").setDesc("同时删除这个服务下的模型配置").addButton((button) => button
      .setButtonText("删除")
      .setWarning()
      .onClick(() => this.confirmDeleteProfile(profile)));
  }

  private renderSectionHeading(container: HTMLElement, title: string, description: string): void {
    const heading = container.createDiv({ cls: "wc-settings-section-head" });
    heading.createEl("h2", { text: title });
    heading.createEl("p", { text: description });
  }

  private async addProvider(): Promise<void> {
    const profile = createProviderProfile(this.newProviderKind);
    this.plugin.settings.profiles.push(profile);
    this.selectedProfileID = profile.id;
    await this.plugin.savePluginData();
    this.display();
  }

  private async addAgent(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      const agent = await this.plugin.createAgent({
        name: "新 Agent",
        description: "",
        systemInstruction: "",
        enabled: true
      });
      this.selectedAgentID = agent.id;
      new Notice("Agent 已创建，请完成配置并保存");
      this.display();
    } catch (error) {
      new Notice(this.plugin.errorMessage(error));
      button.disabled = false;
    }
  }

  private async saveAgent(
    agent: AgentProfile,
    input: { name: string; description: string; modelID?: string; systemInstruction: string; enabled: boolean },
    button: HTMLButtonElement
  ): Promise<void> {
    button.disabled = true;
    button.setText("保存中…");
    try {
      const saved = await this.plugin.updateAgent(agent.id, input);
      this.selectedAgentID = saved.id;
      new Notice("Agent 已保存");
      this.display();
    } catch (error) {
      new Notice(this.plugin.errorMessage(error));
      button.disabled = false;
      button.setText("保存 Agent");
    }
  }

  private async updateProfileEnabled(profile: ProviderProfile, enabled: boolean): Promise<void> {
    profile.enabled = enabled;
    await this.plugin.savePluginData();
    this.display();
  }

  private confirmReset(): void {
    new ConfirmSettingsActionModal(
      this.plugin,
      "重置 Writer Copilot？",
      "模型服务、Agent 配置、默认模型和写作偏好将恢复初始状态。会话记录会保留。",
      "确认重置",
      async () => {
        await this.plugin.resetSettings();
        this.selectedProfileID = undefined;
        this.selectedAgentID = undefined;
        this.activeTab = "basic";
        new Notice("Writer Copilot 设置已重置");
        this.display();
      }
    ).open();
  }

  private confirmClearSessions(): void {
    new ConfirmSettingsActionModal(
      this.plugin,
      "清空全部会话？",
      "所有本地聊天记录都会被永久删除，这个操作无法撤销。",
      "确认清空",
      async () => {
        await this.plugin.clearAllSessions();
        new Notice("会话记录已清空");
        this.display();
      }
    ).open();
  }

  private confirmDeleteProfile(profile: ProviderProfile): void {
    new ConfirmSettingsActionModal(
      this.plugin,
      `删除“${profile.name}”？`,
      "这个提供商、它的 API Key 引用和所有模型配置都会被删除。",
      "确认删除",
      async () => {
        this.plugin.settings.profiles = this.plugin.settings.profiles.filter((item) => item.id !== profile.id);
        const removedIDs = new Set(this.plugin.settings.models.filter((item) => item.profileID === profile.id).map((item) => item.id));
        this.plugin.settings.models = this.plugin.settings.models.filter((item) => item.profileID !== profile.id);
        if (this.plugin.settings.chatModelID && removedIDs.has(this.plugin.settings.chatModelID)) this.plugin.settings.chatModelID = undefined;
        if (this.plugin.settings.inlineModelID && removedIDs.has(this.plugin.settings.inlineModelID)) this.plugin.settings.inlineModelID = undefined;
        this.plugin.setSecret(profile.secretID, "");
        this.selectedProfileID = this.plugin.settings.profiles[0]?.id;
        await this.plugin.savePluginData();
        new Notice("提供商已删除");
        this.display();
      }
    ).open();
  }

  private confirmDeleteAgent(agent: AgentProfile): void {
    new ConfirmSettingsActionModal(
      this.plugin,
      `删除“${agent.name}”？`,
      "删除后，引用它的历史会话会自动改用当前默认 Agent。这个操作无法撤销。",
      "确认删除",
      async () => {
        await this.plugin.deleteAgent(agent.id);
        this.selectedAgentID = this.plugin.settings.defaultAgentID ?? this.plugin.agents[0]?.id;
        new Notice("Agent 已删除");
        this.display();
      }
    ).open();
  }

  private sessionDirectory(): string {
    return `${this.plugin.manifest.dir ?? `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`}/sessions`;
  }

  private async syncModels(profile: ProviderProfile, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    button.setText("同步中…");
    try {
      const models = await this.plugin.discoverModels(profile.id);
      this.addModels(profile, models);
      await this.plugin.savePluginData();
      new Notice(`已同步 ${models.length} 个模型`);
      this.display();
    } catch (error) {
      new Notice(this.plugin.errorMessage(error));
      button.disabled = false;
      button.setText("从接口同步");
    }
  }

  private async testProfile(profile: ProviderProfile, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    button.setText("测试中…");
    try {
      const count = await this.plugin.testProfile(profile.id);
      new Notice(`连接成功，接口返回 ${count} 个模型`);
    } catch (error) {
      new Notice(this.plugin.errorMessage(error));
    } finally {
      button.disabled = false;
      button.setText("测试连接");
    }
  }

  private addModels(profile: ProviderProfile, models: Array<{ id: string; label: string }>): void {
    let firstAddedID: string | undefined;
    for (const remote of models) {
      const id = `${profile.id}:${remote.id}`;
      const existing = this.plugin.settings.models.find((model) => model.id === id);
      if (existing) {
        existing.label = remote.label || remote.id;
        existing.enabled = true;
      } else {
        this.plugin.settings.models.push({ id, profileID: profile.id, providerModelID: remote.id, label: remote.label || remote.id, enabled: true });
        firstAddedID ??= id;
      }
    }
    if (!this.plugin.settings.chatModelID && firstAddedID) this.plugin.settings.chatModelID = firstAddedID;
  }
}

class WritingActionEditorModal extends Modal {
  constructor(
    private readonly plugin: WriterCopilotPlugin,
    private readonly existing: WritingActionDefinition | undefined,
    private readonly save: (input: WritingActionInput) => Promise<void>
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.modalEl.addClass("wc-writing-action-editor-modal");
    this.contentEl.addClass("wc-writing-action-editor");
    this.contentEl.createEl("h2", { text: this.existing ? "编辑写作动作" : "新建写作动作" });
    this.contentEl.createEl("p", {
      text: "动作没有系统保护项。保存后可以继续修改、停用、排序或删除。",
      cls: "setting-item-description"
    });
    let name = this.existing?.name ?? "";
    let description = this.existing?.description ?? "";
    let instruction = this.existing?.instruction ?? "";
    let scope: WritingActionScope = this.existing?.scope ?? "selection";
    let defaultApplyMode = this.existing?.defaultApplyMode ?? "replace";
    let enabled = this.existing?.enabled ?? true;

    new Setting(this.contentEl).setName("名称").setDesc("显示在选区或 / 菜单中").addText((input) => {
      input.inputEl.addClass("wc-settings-wide-input");
      input.setPlaceholder("例如：改得更口语").setValue(name).onChange((value) => { name = value; });
    });
    new Setting(this.contentEl).setName("说明").setDesc("可选，用于帮助识别动作").addText((input) => {
      input.inputEl.addClass("wc-settings-wide-input");
      input.setPlaceholder("一句话说明动作效果").setValue(description).onChange((value) => { description = value; });
    });
    new Setting(this.contentEl).setName("适用位置").setDesc("控制动作出现在哪个菜单").addDropdown((dropdown) => dropdown
      .addOption("selection", "选中文字")
      .addOption("cursor", "空白行 / 菜单")
      .addOption("both", "两者都可用")
      .setValue(scope)
      .onChange((value) => { scope = value as WritingActionScope; }));
    new Setting(this.contentEl).setName("建议写回方式").setDesc("预览页仍会保留其他安全写回按钮").addDropdown((dropdown) => dropdown
      .addOption("replace", "替换原文")
      .addOption("insert-after", "插入下方")
      .addOption("insert-cursor", "插入光标")
      .setValue(defaultApplyMode)
      .onChange((value) => { defaultApplyMode = value as WritingActionDefinition["defaultApplyMode"]; }));
    new Setting(this.contentEl).setName("启用").setDesc("停用后保留配置，但不出现在动作菜单中").addToggle((toggle) =>
      toggle.setValue(enabled).onChange((value) => { enabled = value; })
    );
    new Setting(this.contentEl).setName("动作指令").setDesc("告诉模型应该如何处理正文；不需要重复输出协议").addTextArea((input) => {
      input.inputEl.rows = 8;
      input.inputEl.addClass("wc-settings-prompt");
      input.setPlaceholder("例如：保留原意，把表达改得更自然、更口语，不增加新事实。").setValue(instruction).onChange((value) => { instruction = value; });
    });

    const actions = this.contentEl.createDiv({ cls: "wc-dialog-actions" });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    const confirm = actions.createEl("button", { text: "保存动作", cls: "mod-cta" });
    confirm.addEventListener("click", () => void this.submit(confirm, {
      name,
      description,
      instruction,
      scope,
      enabled,
      defaultApplyMode
    }));
  }

  private async submit(button: HTMLButtonElement, input: WritingActionInput): Promise<void> {
    button.disabled = true;
    try {
      await this.save(input);
      new Notice(this.existing ? "写作动作已更新" : "写作动作已创建");
      this.close();
    } catch (error) {
      new Notice(this.plugin.errorMessage(error));
      button.disabled = false;
    }
  }
}

class ConfirmSettingsActionModal extends Modal {
  constructor(
    private readonly plugin: WriterCopilotPlugin,
    private readonly titleText: string,
    private readonly bodyText: string,
    private readonly actionLabel: string,
    private readonly action: () => Promise<void>
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.contentEl.addClass("wc-confirm-modal");
    this.contentEl.createEl("h2", { text: this.titleText });
    this.contentEl.createEl("p", { text: this.bodyText });
    const actions = this.contentEl.createDiv({ cls: "wc-dialog-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());
    const confirm = actions.createEl("button", { text: this.actionLabel, cls: "mod-warning" });
    confirm.addEventListener("click", () => void this.runAction(confirm));
  }

  private async runAction(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      await this.action();
      this.close();
    } catch (error) {
      new Notice(this.plugin.errorMessage(error));
      button.disabled = false;
    }
  }
}

function addModelOptions(
  dropdown: { addOption(value: string, display: string): unknown; setValue(value: string): unknown },
  models: ModelOption[],
  selected: string | undefined,
  emptyLabel = "请选择模型"
): void {
  dropdown.addOption("", emptyLabel);
  for (const model of models) dropdown.addOption(model.id, model.label);
  dropdown.setValue(selected ?? "");
}

function addWritingActionOptions(
  dropdown: { addOption(value: string, display: string): unknown; setValue(value: string): unknown },
  actions: WritingActionDefinition[],
  selected: string | undefined
): void {
  dropdown.addOption("", "未设置");
  for (const action of actions) dropdown.addOption(action.id, action.name);
  dropdown.setValue(selected ?? "");
}

function scopeLabel(scope: WritingActionScope): string {
  if (scope === "selection") return "选区";
  if (scope === "cursor") return "空白行";
  return "选区与空白行";
}

function providerLabel(kind: ProviderKind): string {
  if (kind === "anthropic") return "Anthropic";
  if (kind === "gemini") return "Google Gemini";
  return "OpenAI 兼容";
}

function baseURLHint(kind: ProviderKind): string {
  if (kind === "anthropic") return "通常为 https://api.anthropic.com/v1";
  if (kind === "gemini") return "通常为 https://generativelanguage.googleapis.com/v1beta";
  return "填写包含 /v1 的基础地址";
}
