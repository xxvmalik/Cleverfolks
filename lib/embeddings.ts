const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3";
const BATCH_SIZE = 128;
const MAX_RETRIES = 3;

async function fetchWithRetry(texts: string[]): Promise<number[][]> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(VOYAGE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        },
        body: JSON.stringify({ input: texts, model: VOYAGE_MODEL }),
      });

      if (response.status === 429) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (!response.ok) {
        throw new Error(`Voyage API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
      };

      // Sort by index to preserve order
      const sorted = data.data.sort((a, b) => a.index - b.index);
      return sorted.map((item) => item.embedding);
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) {
        console.error("Voyage AI embedding error:", err);
        return texts.map(() => []);
      }
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return texts.map(() => []);
}

export async function createEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const results: number[][] = new Array(texts.length).fill([]);

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchEmbeddings = await fetchWithRetry(batch);
    for (let j = 0; j < batchEmbeddings.length; j++) {
      results[i + j] = batchEmbeddings[j];
    }
  }

  return results;
}

export async function createEmbedding(text: string): Promise<number[]> {
  const results = await createEmbeddings([text]);
  return results[0] ?? [];
}
