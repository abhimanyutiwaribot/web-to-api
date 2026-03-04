import * as cheerio from "cheerio";

export function cleanHTML(html: string): string {
  const $ = cheerio.load(html);

  // Remove completely useless tags
  const removeTags = [
    "script",
    "style",
    "noscript",
    "svg",
    "canvas",
    "iframe",
    "form",
    "input",
    "button"
  ];

  removeTags.forEach(tag => $(tag).remove());

  // Remove layout / navigation noise
  const removeSelectors = [
    "nav",
    "footer",
    "header",
    "aside",
    ".navbar",
    ".navigation",
    ".menu",
    ".sidebar",
    ".footer",
    ".ads",
    ".advertisement",
    ".popup",
    ".modal",
    ".cookie",
    ".banner"
  ];

  removeSelectors.forEach(sel => $(sel).remove());

  // Remove attributes that waste tokens
  $("*").each((_, el) => {
    $(el).removeAttr("style");
    $(el).removeAttr("onclick");
    $(el).removeAttr("onload");
    $(el).removeAttr("data-*");
  });

  // Try to detect main content container
  let main =
    $("main").html() ||
    $("article").html() ||
    $("#content").html() ||
    $(".content").html() ||
    $(".container").html();

  if (!main) {
    main = $("body").html() || "";
  }

  const cleaned = cheerio.load(main);

  // Remove empty elements
  cleaned("*").each((_, el) => {
    const text = cleaned(el).text().trim();
    const children = cleaned(el).children().length;

    if (!text && children === 0) {
      cleaned(el).remove();
    }
  });

  return cleaned.root().html() || "";
}