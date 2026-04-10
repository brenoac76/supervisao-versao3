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
      throw new Error("Projeto Google Cloud não detectado. O Vertex AI requer um ambiente Cloud Run ou variável de projeto.");
    }

    console.log(`[AI] Tentando via Vertex AI (Identity-based) no projeto: ${project}`);
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
    try {
      const { text } = req.body;
      const prompt = `Melhore o seguinte texto para torná-lo mais profissional, claro e conciso, mantendo o sentido original. O texto é uma observação técnica ou lembrete de uma agenda de montagem de móveis:\n\n"${text}"`;
      const improvedText = await callVertexAI(prompt);
      res.json({ text: improvedText });
    } catch (error: any) {
      console.error("Vertex AI Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // API para Analisar Etiquetas (Fallback)
  app.post("/api/ai/analyze-label", async (req, res) => {
    try {
      const { image, prompt } = req.body;
      const resultText = await callVertexAI(prompt, { mimeType: "image/jpeg", data: image });
      res.json({ text: resultText });
    } catch (error: any) {
      console.error("Vertex AI Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Configuração do Vite / Estáticos
  const isProd = process.env.NODE_ENV === "production" || process.env.VITE_PROD === "true";
  
  if (!isProd) {
    try {
      console.log("[Server] Iniciando em modo de DESENVOLVIMENTO (Vite)...");
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.warn("[Server] Falha ao carregar Vite, revertendo para modo de PRODUÇÃO:", e);
      serveStatic(app);
    }
  } else {
    console.log("[Server] Iniciando em modo de PRODUÇÃO...");
    serveStatic(app);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

function serveStatic(app: any) {
  const distPath = path.join(process.cwd(), 'dist');
  console.log(`[Server] Pasta dist configurada em: ${distPath}`);
  
  app.use(express.static(distPath));
  
  // Fallback para SPA (deve ser a ÚLTIMA rota)
  app.all('*', (req: any, res: any) => {
    // Se for uma rota de API que não foi capturada acima
    if (req.path.startsWith('/api')) {
      console.warn(`[404] API não encontrada: ${req.method} ${req.path}`);
      return res.status(404).json({ error: `API route ${req.path} not found` });
    }
    
    // Para todas as outras rotas, serve o index.html (SPA)
    if (req.method === 'GET') {
      const indexPath = path.join(distPath, 'index.html');
      res.sendFile(indexPath, (err: any) => {
        if (err) {
          console.error(`[Server] Erro ao enviar index.html: ${err.message}`);
          res.status(500).send("Erro ao carregar o aplicativo. Verifique se o build foi concluído.");
        }
      });
    } else {
      res.status(404).send('Not Found');
    }
  });
}

startServer();
