import { EditorSuggest, type Editor, type EditorPosition, type EditorSuggestContext, type EditorSuggestTriggerInfo, type TFile } from "obsidian";
import type WriterCopilotPlugin from "../main";
import type { WritingActionDefinition } from "../types";
import { customAction } from "./inline-modal";
import { slashTrigger } from "../writing/slash-trigger";

export class WritingSlashSuggest extends EditorSuggest<WritingActionDefinition> {
  constructor(private readonly plugin: WriterCopilotPlugin) {
    super(plugin.app);
    this.limit = 20;
    this.setInstructions([
      { command: "↑↓", purpose: "选择动作" },
      { command: "↵", purpose: "打开预览" },
      { command: "esc", purpose: "关闭" }
    ]);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    if (!this.plugin.settings.slashCommandsEnabled) return null;
    return slashTrigger(editor.getLine(cursor.line).slice(0, cursor.ch), cursor);
  }

  getSuggestions(context: EditorSuggestContext): WritingActionDefinition[] {
    const query = context.query.trim().toLocaleLowerCase("zh-CN");
    const actions = [...this.plugin.writingActionService.list("cursor", true), customAction("cursor")];
    if (!query) return actions;
    return actions.filter((action) => `${action.name} ${action.description}`.toLocaleLowerCase("zh-CN").includes(query));
  }

  renderSuggestion(action: WritingActionDefinition, el: HTMLElement): void {
    const title = el.createDiv({ cls: "wc-slash-action-title" });
    title.createSpan({ text: action.name });
    if (action.id === this.plugin.settings.defaultCursorActionID) title.createSpan({ text: "默认", cls: "wc-writing-default-badge" });
    if (action.description) el.createDiv({ text: action.description, cls: "wc-slash-action-description" });
  }

  selectSuggestion(action: WritingActionDefinition, _event: MouseEvent | KeyboardEvent): void {
    const context = this.context;
    if (!context) return;
    this.close();
    context.editor.replaceRange("", context.start, context.end);
    context.editor.setCursor(context.start);
    const bundle = this.plugin.contextService.getCursorBundle();
    if (!bundle) return;
    if (action.id === "__custom__") this.plugin.openCustomInline(bundle, action);
    else this.plugin.openInlinePreview(bundle, action);
  }
}
