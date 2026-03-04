import * as cheerio from "cheerio";

export function cleanHTML(html: string) {
  const $ = cheerio.load(html);

  $("script").remove();
  $("style").remove();
  $("svg").remove();
  $("noscript").remove();

  return $("body").html();
}