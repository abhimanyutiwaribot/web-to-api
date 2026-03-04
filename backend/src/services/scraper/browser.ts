import { chromium, type Browser } from "playwright";

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if(!browser){
    browser = await chromium.launch({
      headless: true
    })
  }

  return browser
}