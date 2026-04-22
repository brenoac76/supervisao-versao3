import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import { VertexAI } from "@google-cloud/vertexai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Logger de requisições
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", env: process.env.NODE_ENV });
  });

  // Helper para chamar a IA via Vertex AI (Fallback sem API Key)
  const callVertexAI = async (prompt: string, image?: { mimeType: string, data: string }) => {
    const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID || process.env.GCP_PROJECT;
    const location = process.env.GOOGLE_CLOUD_REGION || process.env.REGION || 'us-central1';

    if (!project) {
      console.error("[AI] Erro: GOOGLE_CLOUD_PROJECT não definido.");
      throw new Error("Projeto Google Cloud não detectado. O Vertex AI requer um ambiente Cloud Run ou variável de projeto.");
    }

    console.log(`[AI] Chamando Vertex AI no projeto: ${project}`);
    const vertexAI = new VertexAI({ project, location });
    const model = vertexAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const parts: any[] = image 
      ? [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.data } }]
      : [{ text: prompt }];

    const result = await model.generateContent({
      contents: [{ role: 'user', parts }]
    });

    const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Resposta vazia do Vertex AI");
    return text;
  };

  // API para Profissionalizar Texto (Fallback)
  app.post("/api/ai/professionalize", async (req, res) => {
    console.log("[API] Recebida requisição para professionalize");
    try {
      const { text } = req.body;
      if (!text) return res.status(400).json({ error: "Texto não fornecido" });
      
      const prompt = `Melhore o seguinte texto para torná-lo mais profissional, claro e conciso, mantendo o sentido original. O texto é uma observação técnica ou lembrete de uma agenda de montagem de móveis:\n\n"${text}"`;
      const improvedText = await callVertexAI(prompt);
      res.json({ text: improvedText });
    } catch (error: any) {
      console.error("[API] Erro em professionalize:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // API para Analisar Etiquetas (Fallback)
  app.post("/api/ai/analyze-label", async (req, res) => {
    console.log("[API] Recebida requisição para analyze-label");
    try {
      const { image, prompt } = req.body;
      if (!image) return res.status(400).json({ error: "Imagem não fornecida" });
      
      const resultText = await callVertexAI(prompt || "Analise esta etiqueta", { mimeType: "image/jpeg", data: image });
      res.json({ text: resultText });
    } catch (error: any) {
      console.error("[API] Erro em analyze-label:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // API para Proxy de Imagens (Contorna CORS)
  app.get("/api/proxy-image", async (req, res) => {
    const url = req.query.url as string;
    if (!url) return res.status(400).json({ error: "URL não fornecida" });
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Falha ao buscar imagem");
      const buffer = Buffer.from(await response.arrayBuffer());
      res.set("Content-Type", response.headers.get("content-type") || "image/jpeg");
      res.send(buffer);
    } catch (error: any) {
      console.error("[API] Erro ao proxy imagem:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Configuração do Vite / Estáticos
  const isProd = process.env.NODE_ENV === "production" || process.env.VITE_PROD === "true";
  
  if (isProd) {
    console.log("[Server] Iniciando em modo de PRODUÇÃO...");
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    
    // API 404 Handler (para rotas /api que não existam)
    app.use("/api", (req, res) => {
      console.warn(`[404] API não encontrada: ${req.method} ${req.path}`);
      res.status(404).json({ error: `API route ${req.method} ${req.path} not found` });
    });

    // SPA Fallback
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    console.log("[Server] Iniciando em modo de DESENVOLVIMENTO (Vite)...");
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
