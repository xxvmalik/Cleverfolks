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
