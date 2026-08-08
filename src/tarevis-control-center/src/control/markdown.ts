import DOMPurify from "dompurify";
import { marked } from "marked";

// 配置 marked:启用 GFM,换行转 <br>
marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * 将 markdown 文本渲染为安全的 HTML,用于 agent 对话消息展示。
 * 使用 marked 解析 + DOMPurify 清洗,防止 XSS。
 */
export function renderMarkdown(text: string): string {
  const rawHtml = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "del", "code", "pre",
      "ul", "ol", "li", "blockquote", "a", "hr",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "table", "thead", "tbody", "tr", "th", "td",
      "span", "div",
    ],
    ALLOWED_ATTR: ["href", "title", "target", "rel", "class"],
  });
}
