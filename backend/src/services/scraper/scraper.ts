/// <reference lib="dom" />
import { getBrowser } from "./browser";
import { cleanAndToMarkdown } from "./cleaner";
import type { Route } from "playwright";

export async function scraper(url: string): Promise<{ markdown: string, html: string, cleanedHtml: string } | null> {
  const browser = await getBrowser();

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.google.com/"
    }
  });

  const page = await context.newPage();

  try {
    // Block only heavy media — keep CSS so class names are real in the DOM
    await page.route("**/*.{png,jpg,jpeg,svg,webp,gif,woff,woff2,ttf,otf}", (route: Route) => {
      route.abort();
    });

    // Navigate and wait for initial load
    await page.goto(url, {
      waitUntil: "domcontentloaded", // Faster initial check
      timeout: 60000
    });

    // 1. Handle SPAs: Wait for network to be mostly idle
    try {
      await page.waitForLoadState("networkidle", { timeout: 5000 });
    } catch (e) {
      console.log("Network didn't go idle, proceeding anyway...");
    }

    // 2. Handle Lazy Loading: Scroll down to trigger React effects/API calls
    await autoScroll(page);

    // Final short wait for any animations to finish
    await page.waitForTimeout(1000);

    const html = await page.content();
    console.log(`[SCRAPER] Raw HTML length: ${html?.length || 0}`);

    if (!html || html.length < 100) {
      throw new Error("Page content is too empty");
    }

    const cleaned = cleanAndToMarkdown(html);
    console.log(`[SCRAPER] Cleaned Markdown length: ${cleaned.markdown?.length || 0}`);

    if (!cleaned.markdown) {
      console.warn("Cleaning resulted in empty content for:", url);
    }

    return {
      markdown: cleaned.markdown,
      html: html,           // Full raw HTML for CSS selector engine
      cleanedHtml: cleaned.cleanedHTML  // Stripped HTML used for Markdown
    };

  } catch (error: any) {
    console.error(`Scraping failed for ${url}:`, error.message);
    throw new Error(`Failed to scrape page: ${error.message}`);
  } finally {
    await page.close();
    await context.close();
  }
}

/**
 * Automates scrolling to the bottom of the page to trigger 
 * lazy-loaded content (React Infinite Scroll, etc.)
 */
async function autoScroll(page: any) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const doc = document as any;
        const win = window as any;
        const scrollHeight = doc.body.scrollHeight;
        win.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight || totalHeight >= 4000) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}


// scraper("https://abhimanyutiwaribot.vercel.app")