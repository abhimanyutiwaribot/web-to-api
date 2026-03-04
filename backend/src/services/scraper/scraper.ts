import { getBrowser } from "./browser";
import { cleanHTML } from "./cleaner";

export async function scraper(url: string){
  const browser = await getBrowser();

  const context = await browser.newContext({
    // proxy: {
    //   server: "http://proxy:port"
    // },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
  })

  const page = await context.newPage();

  try {
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();

      if(type === "image" || type === "font" || type === "media"){
        route.abort();
      }else{
        route.continue();
      }
    })

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 15000
    })

    await page.waitForTimeout(1000);

    const html = await page.content();

    const cleaned = cleanHTML(html);
    console.log(cleaned)
    return cleaned;
  } catch(error) {
    console.error("Scraping failed", error)
    throw new Error("Failed to scrape page")
  } finally {
    await page.close();
    await context.close();
  }
}


scraper("https://abhimanyutiwaribot.vercel.app")