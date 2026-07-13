import { describe, expect, it } from "vitest";
import { WritingActionService } from "../src/writing/action-service";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("WritingActionService", () => {
  it("treats seeded actions as ordinary deletable actions", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const service = new WritingActionService(() => settings);
    service.delete("action-rewrite");
    expect(service.get("action-rewrite")).toBeUndefined();
    expect(settings.defaultSelectionActionID).toBeUndefined();
  });

  it("supports custom defaults and clears invalid defaults", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const service = new WritingActionService(() => settings);
    const action = service.create({ name: "我的动作", instruction: "按我的风格修改", scope: "both" });
    service.setDefault("selection", action.id);
    service.setDefault("cursor", action.id);
    expect(service.list("selection", true)[0].id).toBe(action.id);
    service.setEnabled(action.id, false);
    expect(settings.defaultSelectionActionID).toBeUndefined();
    expect(settings.defaultCursorActionID).toBeUndefined();
  });
});
