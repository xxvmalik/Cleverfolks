"use client";

// ── Shared markdown renderer for CleverBrain & Skyler chat messages ──────────

function applyInline(s: string): string {
  return s
    .replace(
      /`([^`]+)`/g,
      '<code class="bg-[#0D0F12] text-[#3A89FF] rounded px-1 py-0.5 font-mono text-[0.85em]">$1</code>'
    )
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

export function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  const parts: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let inList: "ul" | "ol" | null = null;

  const flushList = () => {
    if (inList) {
      parts.push(`</${inList}>`);
      inList = null;
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        const escaped = codeLines
          .join("\n")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        parts.push(
          `<pre class="bg-[#0D0F12] rounded-lg p-3 my-3 overflow-x-auto"><code class="text-sm font-mono text-[#E0E0E0] whitespace-pre">${escaped}</code></pre>`
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        flushList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const isUl = /^[-*] /.test(line);
    const isOl = /^\d+\. /.test(line);

    if (!isUl && inList === "ul") flushList();
    if (!isOl && inList === "ol") flushList();

    if (/^### /.test(line)) {
      parts.push(
        `<h3 class="text-white font-semibold text-base mt-4 mb-1">${applyInline(line.slice(4))}</h3>`
      );
    } else if (/^## /.test(line)) {
      parts.push(
        `<h2 class="text-white font-semibold text-lg mt-4 mb-2">${applyInline(line.slice(3))}</h2>`
      );
    } else if (/^# /.test(line)) {
      parts.push(
        `<h1 class="text-white font-bold text-xl mt-4 mb-2">${applyInline(line.slice(2))}</h1>`
      );
    } else if (isUl) {
      if (inList !== "ul") {
        parts.push('<ul class="list-disc list-outside ml-5 space-y-1 my-2">');
        inList = "ul";
      }
      parts.push(`<li class="text-[#E0E0E0]">${applyInline(line.slice(2))}</li>`);
    } else if (isOl) {
      if (inList !== "ol") {
        parts.push('<ol class="list-decimal list-outside ml-5 space-y-1 my-2">');
        inList = "ol";
      }
      parts.push(`<li class="text-[#E0E0E0]">${applyInline(line.replace(/^\d+\. /, ""))}</li>`);
    } else if (line.trim() === "") {
      parts.push("<br>");
    } else {
      parts.push(`<p class="mb-1 leading-relaxed">${applyInline(line)}</p>`);
    }
  }

  flushList();
  if (inCodeBlock && codeLines.length > 0) {
    const escaped = codeLines
      .join("\n")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    parts.push(
      `<pre class="bg-[#0D0F12] rounded-lg p-3 my-3 overflow-x-auto"><code class="text-sm font-mono text-[#E0E0E0] whitespace-pre">${escaped}</code></pre>`
    );
  }

  return parts.join("");
}

export function MarkdownRenderer({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div
      className={className ?? "text-[#E0E0E0] text-[15px] leading-[1.75]"}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
}
