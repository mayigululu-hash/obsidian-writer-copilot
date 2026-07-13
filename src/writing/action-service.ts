import type { WriterCopilotSettings, WritingActionDefinition, WritingActionScope } from "../types";

export interface WritingActionInput {
  name: string;
  description?: string;
  instruction: string;
  scope: WritingActionScope;
  enabled?: boolean;
  defaultApplyMode?: WritingActionDefinition["defaultApplyMode"];
}

export class WritingActionService {
  constructor(private readonly settings: () => WriterCopilotSettings) {}

  list(scope?: "selection" | "cursor", enabledOnly = false): WritingActionDefinition[] {
    const settings = this.settings();
    const actions = settings.writingActions
      .filter((action) => (!scope || action.scope === scope || action.scope === "both") && (!enabledOnly || action.enabled))
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, "zh-CN"));
    if (!scope) return actions;
    const defaultID = scope === "selection" ? settings.defaultSelectionActionID : settings.defaultCursorActionID;
    return actions.sort((left, right) => Number(right.id === defaultID) - Number(left.id === defaultID));
  }

  get(id: string): WritingActionDefinition | undefined {
    return this.settings().writingActions.find((action) => action.id === id);
  }

  create(input: WritingActionInput): WritingActionDefinition {
    const now = Date.now();
    const action: WritingActionDefinition = {
      id: `action-${crypto.randomUUID()}`,
      ...this.validate(input),
      enabled: input.enabled !== false,
      order: this.settings().writingActions.length,
      createdAt: now,
      updatedAt: now
    };
    this.settings().writingActions.push(action);
    return action;
  }

  update(id: string, input: WritingActionInput): WritingActionDefinition {
    const action = this.require(id);
    Object.assign(action, this.validate(input), { enabled: input.enabled !== false, updatedAt: Date.now() });
    this.repairDefaults();
    return action;
  }

  delete(id: string): void {
    const settings = this.settings();
    settings.writingActions = settings.writingActions.filter((action) => action.id !== id);
    if (settings.defaultSelectionActionID === id) settings.defaultSelectionActionID = undefined;
    if (settings.defaultCursorActionID === id) settings.defaultCursorActionID = undefined;
    this.normalizeOrder();
  }

  setEnabled(id: string, enabled: boolean): void {
    const action = this.require(id);
    action.enabled = enabled;
    action.updatedAt = Date.now();
    this.repairDefaults();
  }

  setDefault(scope: "selection" | "cursor", id: string | undefined): void {
    if (id) {
      const action = this.require(id);
      if (!action.enabled || (action.scope !== scope && action.scope !== "both")) throw new Error("默认动作必须已启用并适用于当前场景");
    }
    if (scope === "selection") this.settings().defaultSelectionActionID = id;
    else this.settings().defaultCursorActionID = id;
  }

  move(id: string, direction: -1 | 1): void {
    const actions = this.settings().writingActions.sort((left, right) => left.order - right.order);
    const index = actions.findIndex((action) => action.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= actions.length) return;
    [actions[index], actions[target]] = [actions[target], actions[index]];
    this.normalizeOrder();
  }

  private validate(input: WritingActionInput): Pick<WritingActionDefinition, "name" | "description" | "instruction" | "scope" | "defaultApplyMode"> {
    const name = input.name.trim().slice(0, 40);
    const instruction = input.instruction.trim().slice(0, 8_000);
    if (!name) throw new Error("请输入动作名称");
    if (!instruction) throw new Error("请输入动作指令");
    return {
      name,
      description: input.description?.trim().slice(0, 120) ?? "",
      instruction,
      scope: input.scope,
      defaultApplyMode: input.defaultApplyMode ?? (input.scope === "selection" ? "replace" : "insert-cursor")
    };
  }

  private require(id: string): WritingActionDefinition {
    const action = this.get(id);
    if (!action) throw new Error("写作动作不存在或已删除");
    return action;
  }

  private repairDefaults(): void {
    const settings = this.settings();
    if (!this.isValidDefault(settings.defaultSelectionActionID, "selection")) settings.defaultSelectionActionID = undefined;
    if (!this.isValidDefault(settings.defaultCursorActionID, "cursor")) settings.defaultCursorActionID = undefined;
  }

  private isValidDefault(id: string | undefined, scope: "selection" | "cursor"): boolean {
    const action = id ? this.get(id) : undefined;
    return Boolean(action?.enabled && (action.scope === scope || action.scope === "both"));
  }

  private normalizeOrder(): void {
    this.settings().writingActions.sort((left, right) => left.order - right.order).forEach((action, index) => { action.order = index; });
  }
}
