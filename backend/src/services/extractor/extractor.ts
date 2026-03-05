import OpenAI from "openai"
import { zodToJsonSchema } from "zod-to-json-schema";
import { ExtractionSchema } from "./schema";

const openRouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_KEY
});

const jsonSchema = zodToJsonSchema(ExtractionSchema as any, "ExtractionSchema");

export function parseLLMJson(text: string) {
  // Better parsing logic to handle markdown blocks
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, text];
  const cleaned = jsonMatch[1]?.trim() || text.trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    console.error("Failed to parse JSON:", text);
    throw new Error("Invalid JSON returned from LLM");
  }
}

import * as cheerio from "cheerio";

/**
 * Uses Cheerio to scan HTML and find the most likely repeating item container.
 * Returns { selector, sampleHtml } so we can verify before asking the AI.
 */
function findRepeatingContainer(html: string): { selector: string; sampleHtml: string } | null {
  const $ = cheerio.load(html);

  // Remove nav/header/footer noise
  $("nav, header, footer, .navbar, .navigation, .footer, .header").remove();

  const counts: Record<string, number> = {};

  // These are known generic utility/layout classes — never meaningful containers
  const genericClasses = new Set([
    "a-section", "a-row", "a-column", "a-span", "a-col", "a-box", "a-declarative",
    "sg-col", "sg-row", "sg-col-inner",
    "d-flex", "d-block", "d-none", "row", "col",
    "container", "wrapper", "inner", "outer",
    "position-relative", "position-absolute",
    "clearfix", "cf", "group"
  ]);

  // Regex for generic/utility prefixes 
  const genericPrefixes = /^(a-spacing|a-padding|a-text|a-size|a-color|a-font|a-link|col-|ph-|icon-|btn-|svg-|js-)/;

  const semanticKeywords = /product|item|result|card|listing|post|article|entry|tile|cell|offer|deal|sku|goods|puisg-col/i;

  $("div, li, article, section").each((_, el) => {
    const classes = ($(el).attr("class") || "").trim().split(/\s+/).filter(Boolean);
    if (classes.length === 0) return;
    const firstClass = classes[0];
    if (!firstClass) return;
    if (genericClasses.has(firstClass)) return;
    if (genericPrefixes.test(firstClass)) return;
    const key = `${el.tagName}.${firstClass}`;
    counts[key] = (counts[key] || 0) + 1;
  });

  const candidates = Object.entries(counts)
    .filter(([, count]) => count >= 3)
    .sort((a, b) => {
      const aScore = a[1] * (semanticKeywords.test(a[0]) ? 3 : 1);
      const bScore = b[1] * (semanticKeywords.test(b[0]) ? 3 : 1);
      return bScore - aScore;
    });

  // --- SECOND PASS: data-attribute containers ---
  // Check both attribute names AND specific attribute values (e.g. Amazon's s-search-result)
  const dataAttrSelectors: Array<{ selector: string; count: number }> = [];
  const dataAttrCandidates = [
    `[data-component-type="s-search-result"]`,
    `[data-component-type="s-item-container"]`,
    `[data-asin]:not([data-asin=''])`,
    `[data-item-id]`,
    `[data-product-id]`,
    `[data-sku]`,
    `[data-component-type]`,
  ];
  dataAttrCandidates.forEach(sel => {
    try {
      const count = $(sel).length;
      if (count >= 3) dataAttrSelectors.push({ selector: sel, count });
    } catch (_) { }
  });
  // Keep insertion order (most specific first) — do NOT sort by count
  const dataAttrWinner = dataAttrSelectors[0];

  if (candidates.length === 0 && !dataAttrWinner) return null;

  // Data-attr wins if it has >= 5 matches (it's a reliable structured container)
  if (dataAttrWinner && dataAttrWinner.count >= 5) {
    const firstEl = $(dataAttrWinner.selector).first();
    const sampleHtml = firstEl.prop("outerHTML")?.slice(0, 3000) || "";
    console.log(`[DISCOVERY] Using data-attribute container: "${dataAttrWinner.selector}" (${dataAttrWinner.count} matches)`);
    return { selector: dataAttrWinner.selector, sampleHtml };
  }

  if (candidates.length === 0) return null;

  const topCandidate = candidates[0]!;
  const topKey = topCandidate[0];
  const topCount = topCandidate[1];
  const cssSelector = `.${topKey.split(".").slice(1).join(".")}`;

  const firstEl = $(cssSelector).first();
  const sampleHtml = firstEl.prop("outerHTML")?.slice(0, 3000) || "";

  console.log(`[DISCOVERY] Detected repeating container: "${cssSelector}" (appears ${topCount} times, semantic: ${semanticKeywords.test(topKey)})`);
  return { selector: cssSelector, sampleHtml };
}

/**
 * DISCOVERY MODE (Advanced):
 * Analyzes HTML to suggest a schema AND infer CSS selectors.
 * Uses a "Verify & Retry" loop so the AI only selects classes that actually exist.
 */
export async function discoverSchemaWithSelectors(markdown: string, rawHtml: string) {
  console.log(`[DISCOVERY] Analyzing content for schema and selector detection...`);

  // Step 1: Use Cheerio to mathematically find the repeating container
  const detected = findRepeatingContainer(rawHtml);

  // Step 2: Skip head, get body for the AI
  const bodyStart = rawHtml.indexOf("<body");
  const bodyHtml = bodyStart > -1 ? rawHtml.slice(bodyStart) : rawHtml;

  // Build a targeted snippet: prioritize the real container's HTML if we found one
  const htmlForAI = detected
    ? `Container element found: "${detected.selector}"\n\nSample of ONE item from that container:\n${detected.sampleHtml}\n\nFull body snippet (for context):\n${bodyHtml.slice(0, 6000)}`
    : bodyHtml.slice(0, 12000);

  const itemSelectorHint = detected
    ? `The repeating container we found is: "${detected.selector}". USE THIS as itemSelector.`
    : `Scan the HTML below and find the container that repeats for each list item.`;

  const discoveryPrompt = `
    You are a CSS selector expert analyzing a webpage to extract structured data.
    Page type: "listing" (multiple repeating items).

    ### YOUR TASK:
    1. ${itemSelectorHint}
    2. For each data field, find the CSS selector RELATIVE to that container element.
       Only use selectors that appear in the HTML sample shown below.

    ### STRICT RULES:
    - The "itemSelector" MUST exactly match what's in the HTML. Do NOT rename or abbreviate classes.
    - Nested field selectors must be RELATIVE to the container (don't repeat the container class).
    - Only output classes/tags you can literally see in the HTML.
    - If a field isn't visible in the HTML sample, omit it.

    ### OUTPUT FORMAT (valid JSON only, no markdown fences):
    {
      "type": "listing",
      "itemSelector": ".exact-class-from-html",
      "fields": {
        "name": { "description": "Product name", "selector": "h2 a" },
        "price": { "description": "Sale price", "selector": ".price" },
        "image": { "description": "Product image", "selector": "img" },
        "url": { "description": "Product URL", "selector": "a" }
      }
    }

    ### PAGE MARKDOWN (for context only):
    ${markdown.slice(0, 2000)}

    ### HTML TO ANALYZE:
    ${htmlForAI}
  `;

  try {
    const completion = await openRouter.chat.completions.create({
      model: "arcee-ai/trinity-large-preview:free",
      messages: [
        {
          role: "system",
          content: "You are a CSS selector extraction engine. You ONLY output valid JSON. You NEVER invent class names. Every selector you output must exist in the HTML provided."
        },
        { role: "user", content: discoveryPrompt }
      ],
      response_format: { type: "json_object" }
    });

    const text = completion.choices[0]?.message.content;
    if (!text) throw new Error("Empty response from AI");

    const result = JSON.parse(text);

    // Step 3: Self-verify — test the itemSelector against the real HTML
    if (result.itemSelector) {
      const $ = cheerio.load(rawHtml);
      const matchCount = $(result.itemSelector).length;
      console.log(`[DISCOVERY] Verifying itemSelector "${result.itemSelector}": found ${matchCount} matches`);

      // If AI hallucinated a selector, override with our detected one
      if (matchCount === 0 && detected) {
        console.warn(`[DISCOVERY] AI selector failed. Overriding with auto-detected: "${detected.selector}"`);
        result.itemSelector = detected.selector;
      }
    }

    return result;
  } catch (error: any) {
    console.error("[DISCOVERY ERROR]", error.message);
    throw new Error("Failed to discover schema and selectors");
  }
}


/**
 * DISCOVERY MODE:
 * Analyzes a page to suggest a structured API schema.
 */
export async function discoverSchema(content: string) {
  console.log(`[DISCOVERY] Analyzing content for schema detection...`);

  const discoveryPrompt = `
    Analyze this webpage content and determine if it is a:
    1. "listing" (A collection/array of many items like products in a category, search results, or blog index).
    2. "product" (A single detailed page for one specific item).
    3. "article" (A single blog post or news story).

    ### RULES:
    1. If it's a LISTING, identify the data points that repeat for EVERY item in the list (e.g., name, price, link).
    2. Create a logical schema with descriptive, camelCase keys for ONE item.
    3. Suggest only 5-10 most important fields.

    ### OUTPUT FORMAT (JSON ONLY):
    {
      "type": "listing | product | article",
      "fields": {
        "fieldKey": "Description of what this field represents"
      },
      "description": "Short summary of what this API captures"
    }

    ### CONTENT:
    ${content.slice(0, 15000)}
  `;

  try {
    const completion = await openRouter.chat.completions.create({
      model: "arcee-ai/trinity-large-preview:free",
      messages: [{ role: "user", content: discoveryPrompt }],
      response_format: { type: "json_object" }
    });

    const text = completion.choices[0]?.message.content;
    return text ? JSON.parse(text) : null;
  } catch (error: any) {
    console.error("[DISCOVERY ERROR]", error.message);
    throw new Error("Failed to discover schema");
  }
}

/**
 * ENFORCEMENT MODE:
 * Extracts data using a specific, pre-defined schema.
 * Now supports PARALLEL processing for speed.
 */
export async function extractor(content: string, targetSchema?: any) {
  const startTime = Date.now();
  console.log(`[EXTRACTOR] Starting parallel extraction for content of length: ${content.length}`);

  // 1. Determine Type
  let pageType = targetSchema?.type || "unknown";

  // 2. Chunking Logic
  const CHUNK_SIZE = 15000;
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += CHUNK_SIZE) {
    chunks.push(content.slice(i, i + CHUNK_SIZE));
  }

  console.log(`[EXTRACTOR] Processing ${chunks.length} chunks in PARALLEL...`);

  const baseSchema = targetSchema?.fields || jsonSchema;
  const promptSchema = pageType === "listing" ? { items: [baseSchema] } : baseSchema;

  // 3. Parallel Extraction Pass
  const extractionPromises = chunks.map(async (chunk, index) => {
    const chunkPrompt = `
      Extract data segment (${index + 1}/${chunks.length}). 
      Target: ${pageType.toUpperCase()}.
      Structure: ${JSON.stringify(promptSchema)}
      Return VALID JSON.
      Content:
      ${chunk}
    `;

    try {
      const completion = await openRouter.chat.completions.create({
        model: "arcee-ai/trinity-large-preview:free", // Back to free tier
        messages: [{ role: "user", content: chunkPrompt }],
        temperature: 0,
        response_format: { type: "json_object" }
      });

      return parseLLMJson(completion.choices[0]?.message.content || "{}");
    } catch (error: any) {
      console.error(`[CHUNK ${index}] Failed:`, error.message);
      return null;
    }
  });

  const results = await Promise.all(extractionPromises);
  const allData = results.filter(r => r !== null);

  // 4. Merge results
  if (allData.length === 0) throw new Error("No data could be extracted.");

  const merged: any = { type: pageType };

  if (pageType === "listing" || Array.isArray(allData[0]?.items)) {
    merged.type = "listing";
    const rawItems = allData.flatMap(d => d.items || []);
    merged.items = rawItems.filter(item => item && Object.values(item).some(v => v !== null));
  } else {
    allData.forEach(chunkData => {
      Object.keys(chunkData).forEach(key => {
        if (key === "type") return;
        if (!merged[key] || String(chunkData[key]).length > String(merged[key]).length) {
          merged[key] = chunkData[key];
        }
      });
    });
  }

  console.log(`[EXTRACTOR] Done in ${Date.now() - startTime}ms`);
  return validateAndMap(merged);
}

/**
 * THE FAST ENGINE:
 * Uses Cheerio + Stored CSS Selectors to extract data WITHOUT AI.
 * Latency: < 500ms
 */
export function fastSelectorExtractor(html: string, project: any) {
  const startTime = Date.now();
  console.log(`[FAST ENGINE] Extracting data using stored selectors for project: ${project.name}`);

  const $ = cheerio.load(html);
  const type = project.type;

  // Cleans raw element text — collapses whitespace/newlines into single space
  const cleanText = (raw: string): string => {
    return raw.replace(/\s+/g, " ").trim();
  };

  // For price fields, extract just the first clean currency amount
  const extractPrice = (raw: string): string => {
    const cleaned = cleanText(raw);
    // Match symbol-based: ₹1,699 or $29.99 or £12.00
    const symbolMatch = cleaned.match(/[₹$£€¥₩]\s?[\d,]+(?:\.\d{1,2})?/);
    if (symbolMatch) return symbolMatch[0].replace(/\s/, "");
    // Match text-based: INR 3,660.74 or USD 29.99 or GBP 12
    const codeMatch = cleaned.match(/\b(INR|USD|GBP|EUR|JPY|AUD|CAD)\s?[\d,]+(?:\.\d{1,2})?/);
    if (codeMatch) return codeMatch[0].replace(/\s/, " ").trim();
    // Last resort: return the cleaned string (already collapsed whitespace)
    return cleaned;
  };

  // Helper to fix common AI selector mistakes (missing leading dot for classes)
  const fixSelector = (sel: string) => {
    if (!sel) return sel;
    // If it looks like a class but missing dot
    if (/^[a-zA-Z]/.test(sel) && !sel.includes(" ") && !sel.includes(">") && !sel.includes(".") && !sel.includes("#")) {
      return `.${sel}`;
    }
    return sel;
  };

  const itemSelector = fixSelector(project.itemSelector);

  if (type === "listing" && itemSelector) {
    const items: any[] = [];
    const containers = $(itemSelector);
    console.log(`[FAST ENGINE] Found ${containers.length} containers matching: ${itemSelector}`);

    containers.each((_, el) => {
      const item: any = {};
      project.rules.forEach((rule: any) => {
        const selector = fixSelector(rule.selector);
        if (selector) {
          const element = selector === "." || selector === "self" ? $(el) : $(el).find(selector);

          if (element.length > 0) {
            // Smart extraction by field type
            if (rule.fieldName.toLowerCase().includes("link") || rule.fieldName.toLowerCase().includes("url")) {
              // Skip javascript: and # links, prefer real hrefs
              let href = "";
              element.each((_, el) => {
                const h = $(el).attr("href") || "";
                if (h && !h.startsWith("javascript:") && h !== "#" && !href) {
                  href = h;
                }
              });
              item[rule.fieldName] = href || cleanText(element.text());
            } else if (rule.fieldName.toLowerCase().includes("image") || rule.fieldName.toLowerCase().includes("img")) {
              item[rule.fieldName] = element.attr("src") || element.attr("data-src") || element.attr("srcset");
            } else if (rule.fieldName.toLowerCase().includes("price") || rule.fieldName.toLowerCase().includes("cost") || rule.fieldName.toLowerCase().includes("amount")) {
              item[rule.fieldName] = extractPrice(element.text());
            } else {
              // For text fields (name, title, etc): if element text is empty, try parent text or alt/aria-label
              let text = cleanText(element.text());
              if (!text) {
                text = element.attr("title") || element.attr("alt") || element.attr("aria-label") || "";
              }
              if (!text) {
                // Walk up one level (e.g. h2 > a where text is in h2 not a)
                text = cleanText($(element[0]).parent().text());
              }
              item[rule.fieldName] = text;
            }
          }
        }
      });
      if (Object.keys(item).length > 0) items.push(item);
    });

    console.log(`[FAST ENGINE] Extracted ${items.length} items in ${Date.now() - startTime}ms`);
    return validateAndMap({ type, items });
  } else {
    // Single page (Product/Article)
    const result: any = { type };
    project.rules.forEach((rule: any) => {
      const selector = fixSelector(rule.selector);
      if (selector) {
        const element = $(selector);
        if (element.length > 0) {
          if (rule.fieldName.toLowerCase().includes("link") || rule.fieldName.toLowerCase().includes("url")) {
            result[rule.fieldName] = element.attr("href") || element.attr("src") || cleanText(element.text());
          } else if (rule.fieldName.toLowerCase().includes("image") || rule.fieldName.toLowerCase().includes("img")) {
            result[rule.fieldName] = element.attr("src") || element.attr("data-src") || element.attr("srcset");
          } else if (rule.fieldName.toLowerCase().includes("price") || rule.fieldName.toLowerCase().includes("cost") || rule.fieldName.toLowerCase().includes("amount")) {
            result[rule.fieldName] = extractPrice(element.text());
          } else {
            let text = cleanText(element.text());
            if (!text) {
              text = element.attr("title") || element.attr("alt") || element.attr("aria-label") || "";
            }
            result[rule.fieldName] = text;
          }
        }
      }
    });

    console.log(`[FAST ENGINE] Extracted single record in ${Date.now() - startTime}ms`);
    return validateAndMap(result);
  }
}

/**
 * Validates and maps synonyms for consistency
 */
function validateAndMap(data: any) {
  // Initial default for missing listing items
  if (data.type === "listing" && !Array.isArray(data.items)) {
    data.items = [];
  }

  // Pre-validation mapping to help the LLM succeed
  if (Array.isArray(data.items)) {
    data.items = data.items.map((item: any) => {
      // 1. Add Normalized Helpers (without deleting original keys)
      const title = item.title || item.name || item.heading || item.product_name || item.product_title || "Untitled Item";
      const image = item.image || item.imageUrl || item.image_url || item.thumbnail || (item.images && item.images[0]);
      const link = item.link || item.url || item.href || item.product_url || "";
      const price = item.price || item.sale_price || item.current_price;

      return {
        ...item, // PRESERVE ALL ORIGINAL FIELDS (discount, badge, etc.)
        title: item.title || title,
        image: item.image || image,
        link: item.link || link,
        price: item.price || price
      };
    });
  }

  if (data.type === "article" || data.type === "product") {
    data.title = data.title || data.name || data.heading || data.title_en;
    data.publishedDate = data.publishedDate || data.date || data.published_at;
    data.image = data.image || data.img || data.imageUrl || data.image_url || (data.images && data.images[0]);
    data.description = data.description || data.summary || data.content?.slice(0, 100);
  }

  // Final validation
  const validatedData = ExtractionSchema.safeParse(data);
  if (!validatedData.success) {
    console.error(`[VALIDATION ERROR] Schema: ${data.type}`);
    console.error(JSON.stringify(validatedData.error.format(), null, 2));

    // In production, we might still want to return the raw data if it's "mostly" correct
    return {
      success: true,
      validated: false,
      ...data
    } as any;
  }

  return {
    success: true,
    validated: true,
    ...validatedData.data
  };
}