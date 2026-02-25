const CHUNK_SIZE = 2000;
const OVERLAP_SIZE = 200;

export function chunkText(
  text: string,
  metadata: Record<string, unknown> = {}
): Array<{ text: string; index: number; metadata: Record<string, unknown> }> {
  if (!text || text.trim().length === 0) return [];

  if (text.length < CHUNK_SIZE) {
    return [{ text, index: 0, metadata }];
  }

  const chunks: Array<{ text: string; index: number; metadata: Record<string, unknown> }> = [];
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = "";
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_SIZE) {
      // Flush current chunk first
      if (currentChunk.trim().length > 0) {
        chunks.push({ text: currentChunk.trim(), index: chunkIndex++, metadata });
        currentChunk = currentChunk.slice(-OVERLAP_SIZE);
      }

      // Split large paragraph by sentences
      const sentences = paragraph.split(/(?<=\.)\s+/);
      for (const sentence of sentences) {
        if ((currentChunk + " " + sentence).length > CHUNK_SIZE && currentChunk.trim().length > 0) {
          chunks.push({ text: currentChunk.trim(), index: chunkIndex++, metadata });
          currentChunk = currentChunk.slice(-OVERLAP_SIZE) + " " + sentence;
        } else {
          currentChunk = currentChunk ? currentChunk + " " + sentence : sentence;
        }
      }
    } else if ((currentChunk + "\n\n" + paragraph).length > CHUNK_SIZE && currentChunk.trim().length > 0) {
      chunks.push({ text: currentChunk.trim(), index: chunkIndex++, metadata });
      currentChunk = currentChunk.slice(-OVERLAP_SIZE) + "\n\n" + paragraph;
    } else {
      currentChunk = currentChunk ? currentChunk + "\n\n" + paragraph : paragraph;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push({ text: currentChunk.trim(), index: chunkIndex++, metadata });
  }

  return chunks;
}
