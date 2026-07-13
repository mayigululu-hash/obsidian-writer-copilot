export interface InlineOutputValidation {
  text: string;
  valid: boolean;
  error?: string;
}

const HIDDEN_TAGS = ["think", "analysis"] as const;
const MAX_INLINE_OUTPUT_LENGTH = 100_000;

export function previewInlineOutput(raw: string): string {
  const value = normalize(raw);
  const final = extractFinal(value, false);
  if (final !== undefined) return cleanVisibleText(final);
  if (hasOpenHiddenBlock(value) || startsWithTagPrefix(value)) return "";
  return cleanVisibleText(removeCompleteHiddenBlocks(value));
}

export function finalizeInlineOutput(raw: string): InlineOutputValidation {
  const value = normalize(raw);
  if (!value.trim()) return invalid("模型没有返回可写入的正文");
  if (hasOpenHiddenBlock(value)) return invalid("模型返回了未结束的推理内容，已阻止写回");

  const marked = extractFinal(value, true);
  let text = marked === undefined ? removeCompleteHiddenBlocks(value) : marked;
  text = cleanVisibleText(text);
  if (!text) return invalid("模型没有返回可写入的正文");
  if (text.length > MAX_INLINE_OUTPUT_LENGTH) return invalid("模型返回的正文过长，已阻止写回");
  if (/<\/?(?:think|analysis|final)\b[^>]*>/i.test(text)) return invalid("模型输出仍包含内部标签，已阻止写回");
  if (looksLikeMetaCommentary(text)) return invalid("模型返回了处理说明而不是正文，已阻止写回");
  return { text, valid: true };
}

function extractFinal(value: string, requireClosing: boolean): string | undefined {
  const open = /<final\b[^>]*>/i.exec(value);
  if (!open) return undefined;
  const start = (open.index ?? 0) + open[0].length;
  const remainder = value.slice(start);
  const close = /<\/final\s*>/i.exec(remainder);
  if (!close) return requireClosing ? "" : remainder;
  return remainder.slice(0, close.index);
}

function removeCompleteHiddenBlocks(value: string): string {
  let result = value;
  for (const tag of HIDDEN_TAGS) {
    result = result.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "");
  }
  return result;
}

function hasOpenHiddenBlock(value: string): boolean {
  for (const tag of HIDDEN_TAGS) {
    const opens = value.match(new RegExp(`<${tag}\\b[^>]*>`, "gi"))?.length ?? 0;
    const closes = value.match(new RegExp(`<\\/${tag}\\s*>`, "gi"))?.length ?? 0;
    if (opens > closes) return true;
  }
  return false;
}

function startsWithTagPrefix(value: string): boolean {
  const trimmed = value.trimStart().toLowerCase();
  if (!trimmed.startsWith("<")) return false;
  return ["<think>", "<analysis>", "<final>"].some((tag) => tag.startsWith(trimmed));
}

function cleanVisibleText(value: string): string {
  let result = value.trim();
  const fence = /^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i.exec(result);
  if (fence) result = fence[1].trim();
  return result;
}

function looksLikeMetaCommentary(value: string): boolean {
  const firstLine = value.trimStart().split("\n", 1)[0].trim();
  return /^(?:the user wants|we need|let me|i (?:will|need|should)|以下是(?:改写|修改|优化|压缩)|下面是(?:改写|修改|优化|压缩)|我将|让我(?:来)?)/i.test(firstLine);
}

function normalize(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function invalid(error: string): InlineOutputValidation {
  return { text: "", valid: false, error };
}
