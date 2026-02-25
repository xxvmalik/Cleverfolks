import mammoth from "mammoth";
import * as xlsx from "xlsx";
import JSZip from "jszip";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI, { toFile } from "openai";

const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".ogg", ".webm"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

async function extractWithClaudeVision(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const base64 = buffer.toString("base64");

    // Determine media type
    const mediaTypeMap: Record<string, "image/png" | "image/jpeg" | "image/gif" | "image/webp"> = {
      "image/png": "image/png",
      "image/jpg": "image/jpeg",
      "image/jpeg": "image/jpeg",
      "image/gif": "image/gif",
      "image/webp": "image/webp",
    };
    const resolvedMediaType = mediaTypeMap[mimeType] ?? "image/jpeg";

    const message = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: resolvedMediaType,
                data: base64,
              },
            },
            {
              type: "text",
              text: "Extract all text from this image. If it contains diagrams, charts, or visual information, describe them in detail. Return everything as plain text.",
            },
          ],
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    return textBlock && textBlock.type === "text" ? textBlock.text : "";
  } catch (err) {
    console.error("Claude Vision error:", err);
    return "";
  }
}

async function transcribeWithWhisper(
  buffer: Buffer,
  fileName: string
): Promise<string> {
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const file = await toFile(buffer as Parameters<typeof toFile>[0], fileName);
    const result = await client.audio.transcriptions.create({
      file,
      model: "whisper-1",
    });
    return result.text;
  } catch (err) {
    console.error("Whisper transcription error:", err);
    return "";
  }
}

export async function extractText(
  fileName: string,
  mimeType: string,
  content: Buffer
): Promise<string> {
  const ext = getExtension(fileName);

  try {
    // Plain text / markdown
    if (ext === ".txt" || ext === ".md") {
      return content.toString("utf-8");
    }

    // HTML
    if (ext === ".html" || ext === ".htm") {
      const html = content.toString("utf-8");
      return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }

    // DOCX
    if (ext === ".docx") {
      const result = await mammoth.extractRawText({ buffer: content });
      return result.value;
    }

    // Excel / CSV
    if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
      const workbook = xlsx.read(content, { type: "buffer" });
      const lines: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet, {
          header: 1,
          defval: "",
        }) as unknown[][];
        lines.push(`Sheet: ${sheetName}`);
        for (const row of rows) {
          lines.push((row as unknown[]).map(String).join("\t"));
        }
      }
      return lines.join("\n");
    }

    // PPTX
    if (ext === ".pptx") {
      const zip = await JSZip.loadAsync(content);
      const slideTexts: string[] = [];
      const slideFiles = Object.keys(zip.files).filter((name) =>
        /^ppt\/slides\/slide\d+\.xml$/.test(name)
      );
      slideFiles.sort();
      for (const slideFile of slideFiles) {
        const xml = await zip.files[slideFile].async("string");
        const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? [];
        const text = matches
          .map((m) => m.replace(/<[^>]+>/g, ""))
          .filter(Boolean)
          .join(" ");
        if (text.trim()) slideTexts.push(text.trim());
      }
      return slideTexts.join("\n\n");
    }

    // PDF
    if (ext === ".pdf") {
      try {
        // Dynamic import to avoid CJS/ESM conflicts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pdfModule = await import("pdf-parse") as any;
        const pdfParse = pdfModule.default ?? pdfModule;
        const result = await pdfParse(content);
        if (result.text.trim().length >= 100) {
          return result.text;
        }
        // Scanned PDF — fall through to Claude Vision
        return extractWithClaudeVision(content, "application/pdf");
      } catch (err) {
        console.error("PDF parse error:", err);
        return "";
      }
    }

    // Images
    if (IMAGE_EXTENSIONS.has(ext)) {
      return extractWithClaudeVision(content, mimeType);
    }

    // Audio
    if (AUDIO_EXTENSIONS.has(ext)) {
      return transcribeWithWhisper(content, fileName);
    }

    // Unknown
    console.log(`Unknown file type: ${fileName} (${mimeType})`);
    return "";
  } catch (err) {
    console.error(`File processing error for ${fileName}:`, err);
    return "";
  }
}
