import express from "express";
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

  // Logger de requisições
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", env: process.env.NODE_ENV });
  });

  // Helper para chamar a IA (Tenta API Key primeiro, depois Vertex AI)
  const callAI = async (prompt: string, image?: { mimeType: string, data: string }) => {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.GOOGLE_API_KEY;
    
    // Tenta encontrar o ID do projeto em várias variáveis comuns do Google Cloud
    const project = process.env.GOOGLE_CLOUD_PROJECT || 
                    process.env.PROJECT_ID || 
                    process.env.GCP_PROJECT || 
                    process.env.GOOGLE_PROJECT_ID;
                    
    const location = process.env.GOOGLE_CLOUD_REGION || process.env.REGION || 'us-central1';

    console.log(`[AI] Iniciando chamada. API Key: ${apiKey ? 'Detectada' : 'Ausente'}, Projeto: ${project || 'Não detectado'}`);

    // 1. Tenta via API Key (GoogleGenAI) - Método mais comum e simples
    if (apiKey && apiKey !== 'undefined' && apiKey !== 'null' && apiKey.length > 10) {
      try {
        console.log("[AI] Tentando via GoogleGenAI (API Key)...");
        const ai = new (GoogleGenAI as any)(apiKey);
        const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const contents = image 
          ? [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.data } }] }]
          : [{ role: "user", parts: [{ text: prompt }] }];
          
        const result = await model.generateContent({ contents: contents as any });
        const response = await result.response;
        return response.text();
      } catch (err: any) {
        console.error("[AI] Erro via GoogleGenAI:", err.message);
        // Se falhou por causa da chave, mas temos um projeto, tentamos Vertex
        if (!project) throw new Error(`Erro na API Key: ${err.message}. Por favor, verifique a GEMINI_API_KEY nos Secrets.`);
      }
    }

    // 2. Tenta via Vertex AI (Autenticação por Identidade do Servidor)
    // Mesmo sem o ID do projeto explícito, o SDK da Vertex pode tentar se auto-configurar no Cloud Run
    try {
      console.log("[AI] Tentando via Vertex AI (Identity-based)...");
      const vertexAI = new VertexAI({ 
        project: project || undefined, 
        location: location 
      });
      const model = vertexAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const parts: any[] = image 
        ? [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.data } }]
        : [{ text: prompt }];

      const result = await model.generateContent({
        contents: [{ role: "user", parts }],
      });
      
      const response = result.response;
      const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
      throw new Error("Resposta da Vertex AI veio vazia.");
    } catch (err: any) {
      console.error("[AI] Erro via Vertex AI:", err.message);
      
      // Se chegamos aqui, ambas as tentativas falharam
      if (!apiKey) {
        throw new Error("Configuração de IA Pendente: A GEMINI_API_KEY não foi encontrada. No link externo, você precisa ir em 'Settings' -> 'Secrets' e adicionar a chave GEMINI_API_KEY para que a IA funcione.");
      }
      throw err;
    }
  };

  // API para Profissionalizar Texto
  app.post("/api/ai/professionalize", async (req, res) => {
    console.log(`[API] Professionalize chamado: ${req.body?.text?.substring(0, 20)}...`);
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
    console.log(`[API] Analyze Label chamado.`);
    try {
      const { image, prompt } = req.body;
      const resultText = await callAI(prompt, { mimeType: "image/jpeg", data: image });
      res.json({ text: resultText });
    } catch (error: any) {
      console.error("Erro no servidor (Analyze Label):", error);
      res.status(500).json({ error: error.message || "Erro interno ao processar IA." });
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
