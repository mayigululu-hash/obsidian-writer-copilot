import { Modal, type App, type TFile } from "obsidian";

export class NotePickerModal extends Modal {
  private readonly selected: Set<string>;
  private listEl?: HTMLElement;
  private query = "";

  constructor(
    app: App,
    private readonly files: TFile[],
    selectedPaths: string[],
    private readonly onSubmit: (files: TFile[]) => void
  ) {
    super(app);
    this.selected = new Set(selectedPaths);
  }

  onOpen(): void {
    this.setTitle("选择文档");
    this.modalEl.addClass("writer-copilot-note-picker");
    const search = this.contentEl.createEl("input", {
      cls: "wc-note-search",
      attr: { type: "search", placeholder: "搜索当前 Vault 中的 Markdown 文档", "aria-label": "搜索文档" }
    });
    search.addEventListener("input", () => {
      this.query = search.value.trim().toLocaleLowerCase();
      this.renderList();
    });
    this.listEl = this.contentEl.createDiv({ cls: "wc-note-list" });
    const actions = this.contentEl.createDiv({ cls: "wc-note-picker-actions" });
    const count = actions.createSpan({ cls: "wc-note-count" });
    const refreshCount = () => count.setText(`已选择 ${this.selected.size} 篇`);
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());
    const confirm = actions.createEl("button", { text: "添加文档", cls: "mod-cta" });
    confirm.addEventListener("click", () => {
      this.onSubmit(this.files.filter((file) => this.selected.has(file.path)));
      this.close();
    });
    this.contentEl.addEventListener("change", refreshCount);
    refreshCount();
    this.renderList();
    window.setTimeout(() => search.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();
    const matches = this.files.filter((file) => !this.query || file.path.toLocaleLowerCase().includes(this.query));
    if (matches.length === 0) {
      this.listEl.createDiv({ cls: "wc-note-empty", text: "没有找到相关 Markdown 文档" });
      return;
    }
    for (const file of matches.slice(0, 300)) {
      const label = this.listEl.createEl("label", { cls: "wc-note-row" });
      const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
      checkbox.checked = this.selected.has(file.path);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selected.add(file.path);
        else this.selected.delete(file.path);
      });
      const text = label.createDiv({ cls: "wc-note-row-text" });
      text.createDiv({ cls: "wc-note-name", text: file.basename });
      text.createDiv({ cls: "wc-note-path", text: file.path });
    }
    if (matches.length > 300) {
      this.listEl.createDiv({ cls: "wc-note-limit", text: `还有 ${matches.length - 300} 篇，请继续输入关键词缩小范围` });
    }
  }
}
