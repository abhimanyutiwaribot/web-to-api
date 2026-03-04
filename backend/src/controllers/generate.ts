import { scraper } from "../services/scraper/scraper";
import { extractor } from "../services/extractor/extractor";

export async function generateAPI(url: string){
  const html = await scraper(url);
  if(!html){
    return {
      success: false,
      error: "Scraping failed"
    }
  }
  
  const data = await extractor(html);

  return data;
}