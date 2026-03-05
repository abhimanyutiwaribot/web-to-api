import { scraper } from "../services/scraper/scraper";
import { extractor } from "../services/extractor/extractor";
import { LRUCache } from "lru-cache";

// Simple in-memory cache for production performance
const cache = new LRUCache<string, any>({
  max: 100,
  ttl: 1000 * 60 * 30, // 30 minutes cache
});

export async function generateAPI(url: string) {
  // Check cache first to save costs and time
  const cached = cache.get(url);
  if (cached) {
    console.log(`Cache hit for ${url}`);
    return { ...cached, _from_cache: true };
  }

  console.log(`Cache miss for ${url}. Scraping...`);
  const markdown = await scraper(url);
  if (!markdown) {
    throw new Error("Failed to retrieve content from the provided URL.");
  }

  const data = await extractor(markdown);

  // Store in cache
  cache.set(url, data);

  return { ...data, _from_cache: false };
}