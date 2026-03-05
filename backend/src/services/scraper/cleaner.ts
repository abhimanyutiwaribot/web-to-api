import * as cheerio from "cheerio";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

// Skip noisy elements in markdown conversion
turndown.remove(["script", "style", "noscript", "iframe", "svg", "canvas"] as any);

export function cleanAndToMarkdown(html: string): { markdown: string, cleanedHTML: string } {
  const $ = cheerio.load(html);

  const removeSelectors = [
    "nav", "footer", "header", "aside",
    ".navbar", ".navigation", ".menu", ".sidebar", ".footer",
    ".ads", ".advertisement", ".popup", ".modal", ".cookie", ".banner",
    "form", "input", "button", ".social-share", ".newsletter-signup"
  ];

  removeSelectors.forEach(sel => $(sel).remove());

  // Remove data attributes and styles to stay focused on content
  $("*").each((_, el) => {
    const element = $(el);
    const attributes = (el as any).attribs;
    if (attributes) {
      Object.keys(attributes).forEach(attr => {
        if (attr.startsWith("data-") || attr === "style" || attr.startsWith("on")) {
          element.removeAttr(attr);
        }
      });
    }
  });

  // Try to find the most relevant content block 
  // (prefer main, then article, then specific content classes)
  const contentSelectors = [
    "main", "article", "[role='main']",
    "#content", ".content", ".main-content",
    ".product-list", ".listing", ".catalog",
    ".product-detail", ".article-body"
  ];
  let target = null;

  for (const selector of contentSelectors) {
    const found = $(selector);
    if (found.length > 0) {
      // Basic heuristic: Is it actually content or just a tiny tag?
      const textLength = found.first().text().trim().length;
      if (textLength > 200) {
        target = found.first();
        break;
      }
    }
  }

  const container = target || $("body");

  // Clean up any remaining empty wrappers
  container.find("*").each((_, el) => {
    const node = $(el);
    if (node.children().length === 0 && !node.text().trim() && !["img", "br", "hr"].includes(el.tagName.toLowerCase())) {
      node.remove();
    }
  });

  const cleanedHTML = container.html() || "";

  // Convert to Markdown
  const markdown = turndown.turndown(cleanedHTML);

  return {
    markdown: markdown.trim(),
    cleanedHTML: cleanedHTML
  };
}