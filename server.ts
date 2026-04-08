import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { VertexAI } from "@google-cloud/vertexai";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Helper para chamar a IA (Tenta API Key primeiro, depois Vertex AI)
  const callAI = async (prompt: string, image?: { mimeType: string, data: string }) => {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.GOOGLE_API_KEY;
    const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
    const location = process.env.GOOGLE_CLOUD_REGION || process.env.REGION || 'us-central1';

    console.log(`[AI] Request. Key: ${apiKey ? 'Present' : 'Missing'}, Project: ${project || 'Missing'}`);

    // 1. Tenta via API Key (GoogleGenAI)
    if (apiKey && apiKey !== 'undefined' && apiKey !== 'null' && apiKey !== 'MY_GEMINI_API_KEY' && apiKey.length > 10) {
      try {
        console.log("[AI] Tentando via GoogleGenAI (API Key)...");
        const ai = new GoogleGenAI({ apiKey });
        const contents = image 
          ? [{ parts: [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.data } }] }]
          : [{ role: "user", parts: [{ text: prompt }] }];
          
        const response = await ai.models.generateContent({
          model: "gemini-1.5-flash", // Usando 1.5-flash como fallback estável
          contents: contents as any,
        });
        return response.text;
      } catch (err: any) {
        console.error("[AI] Erro via GoogleGenAI:", err.message);
        if (!project) throw err; // Se não tem projeto, não tem como tentar Vertex
      }
    }

    // 2. Tenta via Vertex AI (Identity-based / Service Account)
    if (project) {
      try {
        console.log("[AI] Tentando via Vertex AI (Identity-based)...");
        const vertexAI = new VertexAI({ project, location });
        const model = vertexAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const parts: any[] = image 
          ? [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.data } }]
          : [{ text: prompt }];

        const result = await model.generateContent({
          contents: [{ role: "user", parts }],
        });
        
        const response = result.response;
        return response.candidates?.[0]?.content?.parts?.[0]?.text;
      } catch (err: any) {
        console.error("[AI] Erro via Vertex AI:", err.message);
        throw err;
      }
    }

    throw new Error("Nenhuma forma de autenticação de IA disponível (API Key ou Projeto Cloud ausentes). No link externo, por favor adicione a GEMINI_API_KEY nos Secrets.");
  };

  // API para Profissionalizar Texto
  app.post("/api/ai/professionalize", async (req, res) => {
    try {
      const { text } = req.body;
      const prompt = `Melhore o seguinte texto de uma pendência técnica de montagem de móveis, deixando-o mais profissional, claro e formal, mantendo a objetividade. Retorne APENAS o texto melhorado, sem comentários adicionais: "${text}"`;
      
      const improvedText = await callAI(prompt);
      res.json({ text: improvedText });
    } catch (error: any) {
      console.error("Erro no servidor (Professionalize):", error);
      res.status(500).json({ error: error.message || "Erro interno ao processar IA." });
    }
  });

  // API para Analisar Etiquetas (MaterialOrderManager)
  app.post("/api/ai/analyze-label", async (req, res) => {
    try {
      const { image, prompt } = req.body;
      const resultText = await callAI(prompt, { mimeType: "image/jpeg", data: image });
      res.json({ text: resultText });
    } catch (error: any) {
      console.error("Erro no servidor (Analyze Label):", error);
      res.status(500).json({ error: error.message || "Erro interno ao processar IA." });
    }
  });

  // Configuração do Vite
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
