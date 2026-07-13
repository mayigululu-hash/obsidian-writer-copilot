import { FuzzySuggestModal, Modal, Notice } from "obsidian";
import type WriterCopilotPlugin from "../main";
import type { ContextBundle, WritingActionDefinition } from "../types";

const CUSTOM_ACTION_ID = "__custom__";
const MANAGE_ACTION_ID = "__manage__";

export class WritingActionPicker extends FuzzySuggestModal<WritingActionDefinition> {
  constructor(
    private readonly plugin: WriterCopilotPlugin,
    private readonly bundle: ContextBundle,
    private readonly selectionOnly: boolean
  ) {
    super(plugin.app);
    this.setPlaceholder(selectionOnly ? "选择改写动作" : "选择续写动作");
  }

  getItems(): WritingActionDefinition[] {
    const scope = this.selectionOnly ? "selection" : "cursor";
    return [...this.plugin.writingActionService.list(scope, true), customAction(scope), manageAction(scope)];
  }

  getItemText(item: WritingActionDefinition): string {
    const settings = this.plugin.settings;
    const defaultID = this.selectionOnly ? settings.defaultSelectionActionID : settings.defaultCursorActionID;
    return item.id === defaultID ? `${item.name} · 默认` : item.name;
  }

  onChooseItem(item: WritingActionDefinition): void {
    if (item.id === MANAGE_ACTION_ID) {
      this.plugin.openWritingSettings();
      return;
    }
    if (item.id === CUSTOM_ACTION_ID) {
      new CustomInstructionModal(this.plugin, this.bundle, item).open();
      return;
    }
    new InlinePreviewModal(this.plugin, this.bundle, item).open();
  }
}

export class CustomInstructionModal extends Modal {
  constructor(
    private readonly plugin: WriterCopilotPlugin,
    private readonly bundle: ContextBundle,
    private readonly action: WritingActionDefinition
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    const selectionMode = this.bundle.snapshot.mode === "selection";
    this.setTitle(selectionMode ? "按要求修改" : "按要求续写");
    const input = this.contentEl.createEl("textarea", {
      cls: "wc-custom-instruction",
      attr: {
        rows: "5",
        placeholder: selectionMode
          ? "例如：保留这种口语感，但让逻辑更紧凑。"
          : "例如：沿着这个观点再写一段具体经历。"
      }
    });
    const actions = this.contentEl.createDiv({ cls: "wc-dialog-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());
    const confirm = actions.createEl("button", { text: "生成", cls: "mod-cta" });
    const submit = () => {
      const instruction = input.value.trim();
      if (!instruction) return;
      this.close();
      new InlinePreviewModal(this.plugin, this.bundle, { ...this.action, instruction }).open();
    };
    confirm.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) submit();
    });
    window.setTimeout(() => input.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class InlinePreviewModal extends Modal {
  private abort?: AbortController;
  private result = "";
  private resultEl?: HTMLElement;
  private statusEl?: HTMLElement;
  private retryButton?: HTMLButtonElement;
  private applyButtons: HTMLButtonElement[] = [];

  constructor(
    private readonly plugin: WriterCopilotPlugin,
    private readonly bundle: ContextBundle,
    private readonly action: WritingActionDefinition
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.modalEl.addClass("writer-copilot-inline-modal");
    this.render();
    void this.generate();
  }

  onClose(): void {
    this.abort?.abort();
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    const header = contentEl.createDiv({ cls: "wc-inline-header" });
    header.createEl("h2", { text: this.action.name });

    if (this.bundle.snapshot.mode === "selection") {
      const original = contentEl.createDiv({ cls: "wc-compare-block" });
      original.createDiv({ cls: "wc-compare-label", text: "原文" });
      original.createDiv({ cls: "wc-original-text", text: this.bundle.snapshot.originalText });
    }

    const suggestion = contentEl.createDiv({ cls: "wc-compare-block wc-suggestion-block" });
    suggestion.createDiv({ cls: "wc-compare-label", text: "建议版本" });
    this.statusEl = suggestion.createDiv({ cls: "wc-generation-status", text: "正在生成…" });
    this.resultEl = suggestion.createDiv({ cls: "wc-suggestion-text" });

    const actions = contentEl.createDiv({ cls: "wc-inline-actions" });
    if (this.bundle.snapshot.mode === "selection") {
      const preferred = this.action.defaultApplyMode === "insert-after" ? "insert-after" : "replace";
      this.applyButtons.push(this.button(actions, "替换原文", preferred === "replace" ? "primary" : "", () => this.apply("replace")));
      this.applyButtons.push(this.button(actions, "插入下方", preferred === "insert-after" ? "primary" : "", () => this.apply("insert-after")));
    } else {
      const preferred = this.action.defaultApplyMode === "insert-after" ? "insert-after" : "insert-cursor";
      this.applyButtons.push(this.button(actions, "插入光标", preferred === "insert-cursor" ? "primary" : "", () => this.apply("insert-cursor")));
      this.applyButtons.push(this.button(actions, "插入下一段", preferred === "insert-after" ? "primary" : "", () => this.apply("insert-after")));
    }
    this.retryButton = this.button(actions, "重新生成", "", () => void this.generate());
    this.button(actions, "发到聊天", "", () => void this.sendToChat());
    this.button(actions, "取消", "", () => this.close());
    this.setApplyEnabled(false);
  }

  private button(parent: HTMLElement, label: string, variant: string, handler: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { text: label, cls: variant ? `mod-${variant}` : "" });
    button.addEventListener("click", handler);
    return button;
  }

  private async generate(): Promise<void> {
    this.abort?.abort();
    this.abort = new AbortController();
    this.result = "";
    this.resultEl?.setText("");
    this.statusEl?.setText("正在生成…");
    this.retryButton?.setText("重新生成");
    this.setApplyEnabled(false);
    try {
      this.result = await this.plugin.generateInline(
        this.action,
        this.bundle,
        (text) => {
          this.result = text;
          this.resultEl?.setText(text);
        },
        this.abort.signal
      );
      this.statusEl?.setText("正文已生成");
      this.setApplyEnabled(Boolean(this.result));
    } catch (error) {
      if (this.abort.signal.aborted) {
        this.statusEl?.setText("已取消");
      } else {
        this.statusEl?.setText(friendlyInlineError(this.plugin.errorMessage(error)));
      this.retryButton?.setText("重新生成");
      }
    }
  }

  private apply(mode: "replace" | "insert-after" | "insert-cursor"): void {
    if (!this.result) return;
    const result = this.plugin.editorService.apply(this.bundle.snapshot, this.result, mode);
    if (!result.ok) {
      new Notice(staleMessage(result.reason));
      return;
    }
    new Notice("已应用，可使用 Obsidian 撤销");
    this.close();
  }

  private async sendToChat(): Promise<void> {
    if (!this.result) return;
    await this.plugin.openCopilotView(this.result);
    this.close();
  }

  private setApplyEnabled(enabled: boolean): void {
    for (const button of this.applyButtons) button.disabled = !enabled;
  }
}

export function customAction(scope: "selection" | "cursor"): WritingActionDefinition {
  return {
    id: CUSTOM_ACTION_ID,
    name: "按要求生成…",
    description: "输入一次性的写作要求",
    instruction: "根据用户的自定义要求处理内容。",
    scope,
    enabled: true,
    order: -1,
    defaultApplyMode: scope === "selection" ? "replace" : "insert-cursor",
    createdAt: 0,
    updatedAt: 0
  };
}

function manageAction(scope: "selection" | "cursor"): WritingActionDefinition {
  return {
    ...customAction(scope),
    id: MANAGE_ACTION_ID,
    name: "管理写作动作…",
    description: "新增、编辑、删除、排序和设置默认动作",
    order: Number.MAX_SAFE_INTEGER
  };
}

function friendlyInlineError(message: string): string {
  if (message.includes("Failed to fetch") || message.includes("无法从 Obsidian") || message.includes("CORS")) {
    return "无法连接模型服务。原文已保留，请检查配置后重新生成。";
  }
  return message;
}

function staleMessage(reason?: string): string {
  if (reason === "file-changed") return "目标文件已切换，无法安全应用";
  if (reason === "selection-changed") return "原文已变化，请基于当前内容重新生成";
  if (reason === "cursor-moved") return "光标位置已变化，请重新生成";
  return "当前没有可写入的 Markdown 编辑器";
}
