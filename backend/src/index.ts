import express from "express"
import generateRouter from "./routes/generate-route";
import projectRouter from "./routes/project-route";

const app = express();
const port = 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send("Hello from / route")
});

app.use('/api/x', generateRouter);
app.use('/api/v1/projects', projectRouter);

app.listen(port, () => {
  console.log("Server is running on: " + port)
})