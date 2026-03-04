import OpenAI from "openai"

const openRouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_KEY
});

export function parseLLMJson(text: string) {
  const cleaned = text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  return JSON.parse(cleaned);
}

export async function extractor(html:string) {
  const prompt = `
    You are an HTML data extraction engine.

Analyze the HTML and determine the page type.

Possible page types:
- product
- listing
- article
- unknown

Rules:

If the page is a PRODUCT page return:

{
  "type": "product",
  "title": "",
  "price": "",
  "rating": "",
  "description": "",
  "images": []
}

If the page is a LISTING page return:

{
  "type": "listing",
  "items": [
    {
      "title": "",
      "price": "",
      "link": "",
      "image": ""
    }
  ]
}

Important rules:
- Extract real content from the HTML
- Do not summarize
- Do not invent information
- Return JSON only
Extract structured data from the HTML.
If a field does not exist on the page, omit it instead of leaving it empty.

HTML:
    ${html.slice(0, 15000)}
  `;

  const completion = await openRouter.chat.completions.create({
    model: "arcee-ai/trinity-large-preview:free",
    messages: [
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0
  });

  const text = completion.choices[0]?.message.content;
  const data = parseLLMJson(text as string);

  return data;
}