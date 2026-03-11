import { tavily } from "@tavily/core";

export type WebResult = {
  title: string;
  url: string;
  content: string;
};

/**
 * Search the web using Tavily and return a flat array of result snippets.
 * Returns [] on any error so callers never have to handle exceptions.
 */
export async function searchWeb(
  query: string,
  maxResults = 5
): Promise<WebResult[]> {
  try {
    const client = tavily({ apiKey: process.env.TAVILY_API_KEY! });
    const response = await client.search(query, { maxResults });
    return (response.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      content: r.content ?? "",
    }));
  } catch (err) {
    console.error("[web-search] Tavily search failed:", err);
    return [];
  }
}

/**
 * Extract content from a specific URL using Tavily extract API.
 * Returns the extracted text or null on failure.
 */
export async function extractWebsite(url: string): Promise<string | null> {
  try {
    const client = tavily({ apiKey: process.env.TAVILY_API_KEY! });
    const response = await client.extract([url]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = (response as any).results ?? [];
    if (results.length === 0) return null;
    const text = results[0].rawContent ?? results[0].text ?? "";
    return text ? String(text).slice(0, 8000) : null;
  } catch (err) {
    console.error(`[web-search] Tavily extract failed for ${url}:`, err);
    return null;
  }
}
