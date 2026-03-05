import { Router } from "express";
import { initProject, getProjectData, listProjects, deleteProject } from "../controllers/projects";

const router = Router();

// 1. List all projects
router.get("/", async (req, res) => {
  try {
    const projects = await listProjects();
    res.json(projects);
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

// 2. Initial Discovery Pass
router.post("/init", async (req, res) => {
  const { url, name } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    const result = await initProject(url, name);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

// 3. Enforcement Pass (Enforced Schema from DB)
router.get("/:projectId/data", async (req, res) => {
  const { projectId } = req.params;
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Target URL is required as a query parameter" });
  }

  try {
    const result = await getProjectData(projectId, url);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

// 4. Delete Project
router.delete("/:projectId", async (req, res) => {
  const { projectId } = req.params;
  try {
    await deleteProject(projectId);
    res.json({ success: true, message: "Project deleted" });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

export default router;
