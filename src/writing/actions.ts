import type { ContextBundle, WritingActionDefinition } from "../types";

const INITIAL_ACTION_TIME = 0;

function initialAction(
  id: string,
  name: string,
  description: string,
  instruction: string,
  scope: WritingActionDefinition["scope"],
  order: number,
  defaultApplyMode: WritingActionDefinition["defaultApplyMode"]
): WritingActionDefinition {
  return { id, name, description, instruction, scope, enabled: true, order, defaultApplyMode, createdAt: INITIAL_ACTION_TIME, updatedAt: INITIAL_ACTION_TIME };
}

export const INITIAL_WRITING_ACTIONS: WritingActionDefinition[] = [
  initialAction("action-rewrite", "自然改写", "保留原意，去掉生硬和 AI 腔", "保留原意，改得更自然、更像真人表达，删除明显的 AI 腔。", "selection", 0, "replace"),
  initialAction("action-compress", "压缩重复", "删除重复、空话和绕弯表达", "删除重复和空话，在不损失核心信息的前提下压缩表达。", "selection", 1, "replace"),
  initialAction("action-proofread", "修正语病", "修正错别字、标点和不通顺表达", "修正错别字、标点、语病和不通顺表达，尽量保留原有语气。", "selection", 2, "replace"),
  initialAction("action-expand", "扩写观点", "补足解释和逻辑", "沿着原观点扩写，补足必要的解释和逻辑，不引入虚构事实。", "selection", 3, "replace"),
  initialAction("action-argument", "加强论证", "补齐论证跳跃", "找出论证跳跃并补齐中间逻辑，保持原有立场。", "selection", 4, "replace"),
  initialAction("action-example", "增加案例", "补充具体可信的例子", "补充一个具体、可信、贴近日常经验的例子；无法确认事实时使用假设性表述。", "selection", 5, "insert-after"),
  initialAction("action-structure", "调整结构", "重新组织句子和段落", "重新组织句子和段落顺序，让观点推进更清楚。", "selection", 6, "replace"),
  initialAction("action-continue", "继续写", "沿当前内容自然续写", "沿着当前段落继续写，不重复已有内容，不另起无关话题。", "cursor", 7, "insert-cursor"),
  initialAction("action-next-paragraph", "写下一段", "生成自然衔接的下一段", "根据已有内容写自然衔接的下一段，不添加无关标题。", "cursor", 8, "insert-after")
];

export function buildInlinePrompt(action: WritingActionDefinition, bundle: ContextBundle, customInstruction?: string): string {
  const instruction = customInstruction?.trim() || action.instruction;
  return [
    "你正在 Obsidian 中协助中文长文写作。",
    `任务：${instruction}`,
    "不要输出分析、推理、说明、备选方案或代码围栏。",
    "最终只按以下协议输出一次正文；<final> 标签外不得有任何内容：",
    "<final>",
    "可以直接放回文章的正文",
    "</final>",
    "保留 Markdown 基本结构；不得调用工具、修改文件或虚构无法确认的事实。",
    bundle.promptContext
  ].join("\n\n");
}

export function buildChatPrompt(message: string, contexts: Array<{ label: string; content: string; filePath: string }>): string {
  if (contexts.length === 0) return message;
  const attachments = contexts
    .map((item) => `【${item.label}｜${item.filePath}】\n${item.content}`)
    .join("\n\n---\n\n");
  return `${message}\n\n以下是用户明确附加的上下文：\n\n${attachments}`;
}
