import { scraper } from "../services/scraper/scraper";
import { discoverSchemaWithSelectors, extractor, fastSelectorExtractor } from "../services/extractor/extractor";
import prisma from "../db";

/**
 * PROJECT INITIALIZATION
 * Scrapes a sample URL, discovers schema + selectors, and SAVES to DB.
 */
export async function initProject(url: string, projectName: string = "New API Project") {
  console.log(`[PROJECT INIT] Initializing project for ${url}`);

  const scraped = await scraper(url);
  if (!scraped) {
    throw new Error("Failed to scrape provided URL for initialization.");
  }

  // 1. Discover the schema + selectors from the content
  // Pass raw HTML (scraped.html) so AI sees the real DOM with all class names
  const discovery = await discoverSchemaWithSelectors(scraped.markdown, scraped.html);
  if (!discovery || !discovery.fields) {
    console.error(`[PROJECT INIT] Discovery failed or returned no fields:`, discovery);
    throw new Error("Could not discover schema from page.");
  }

  console.log(`[PROJECT INIT] Discovery result:`, JSON.stringify(discovery, null, 2));

  // 2. Extract domain from URL
  const baseUrl = new URL(url).origin;

  // 3. Save Project and Rules to DB
  const project = await prisma.project.create({
    data: {
      name: projectName,
      baseUrl,
      type: discovery.type,
      itemSelector: discovery.itemSelector,
      rules: {
        create: Object.entries(discovery.fields).map(([key, data]: [string, any]) => ({
          fieldName: key,
          description: data.description,
          selector: data.selector
        }))
      }
    },
    include: {
      rules: true
    }
  });

  return {
    projectId: project.id,
    name: project.name,
    type: project.type,
    itemSelector: project.itemSelector,
    discoveredSchema: discovery.fields,
  };
}

/**
 * FETCH DATA
 * High Speed Path: Tries CSS Selectors first.
 * Fallback: Uses Parallel AI Extraction.
 */
export async function getProjectData(projectId: string, url: string) {
  // 1. Get Project and Rules from DB
  console.log(`[ROUTE] Looking up project: ${projectId}`);
  let project;
  try {
    project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { rules: true }
    });
  } catch (err: any) {
    console.error(`[DB ERROR] findUnique failed for ${projectId}:`, err.message);
    throw new Error(`Database error: ${err.message}`);
  }

  if (!project) throw new Error(`Project ${projectId} not found.`);

  const scraped = await scraper(url);
  if (!scraped) throw new Error("Failed to scrape URL.");

  // 2. CHECK: Do we have selectors for a high-speed pass?
  const hasSelectors = project.rules.some(r => r.selector);
  console.log(`[ROUTE] Project has selectors: ${hasSelectors}`);

  if (hasSelectors) {
    try {
      console.log(`[ROUTE] Attempting High-Speed Selector Engine...`);
      // Use raw HTML — NOT cleanedHtml — so Cheerio can find all classes the AI saw
      const fastResult = fastSelectorExtractor(scraped.html, project);

      // If listing but no items, or if product but no title, consider it a selector failure
      const isEmptyListing = project.type === "listing" && (!fastResult.items || fastResult.items.length === 0);
      const isMissingProduct = project.type !== "listing" && !fastResult.title;

      if (!isEmptyListing && !isMissingProduct) {
        console.log(`[ROUTE] Success with Fast Engine!`);
        return fastResult;
      }

      console.warn(`[ROUTE] Fast Engine returned empty results. Falling back to AI...`);
    } catch (e: any) {
      console.warn(`[FAST ENGINE ERROR] ${e.message}. Falling back to AI...`);
    }
  } else {
    console.log(`[ROUTE] No selectors found for this project.`);
  }

  // 3. FALLBACK: Parallel AI Extraction
  console.log(`[ROUTE] Triggering Parallel AI Extractor...`);
  const targetSchema = {
    type: project.type,
    fields: project.rules.reduce((acc: any, rule) => {
      acc[rule.fieldName] = rule.description || "extracted data";
      return acc;
    }, {})
  };

  return await extractor(scraped.markdown, targetSchema);
}

/**
 * LIST PROJECTS
 */
export async function listProjects() {
  return await prisma.project.findMany({
    include: { rules: true },
    orderBy: { createdAt: "desc" }
  });
}

/**
 * DELETE PROJECT
 */
export async function deleteProject(projectId: string) {
  return await prisma.project.delete({
    where: { id: projectId }
  });
}
