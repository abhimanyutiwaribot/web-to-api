import express from "express";
import { generateAPI } from "../controllers/generate";

const generateRouter = express.Router();

generateRouter.post('/generate', async (req, res) => {
  const { url } = req.body;
  
  if(!url){
    return res.status(400).json({
      message: "URL is required"
    })
  }

  const data = await generateAPI(url as string)
  
  return res.json({
    data
  });

})


export default generateRouter;