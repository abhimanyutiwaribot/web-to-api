import express from "express";
import { generateAPI } from "../controllers/generate";

const generateRouter = express.Router();

/**
 * POST /api/x/generate
 * Extracts structured data as JSON from any URL.
 */
generateRouter.post("/generate", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      message: "Required parameter 'url' is missing."
    });
  }

  // Basic URL validation
  try {
    new URL(url as string);
  } catch (e) {
    return res.status(400).json({
      success: false,
      message: "Invalid URL provided."
    });
  }

  try {
    // Call the orchestration service
    const data = await generateAPI(url as string);

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...data
    });

  } catch (error: any) {
    console.error(`[ERROR] Processing failed for URL ${url}:`, error.message);

    // Return meaningful status codes
    const status = error.message.includes("timeout") || error.message.includes("scrape") ? 503 : 500;

    return res.status(status).json({
      success: false,
      error: error.message || "An internal error occurred while extracting data."
    });
  }
});

export default generateRouter;