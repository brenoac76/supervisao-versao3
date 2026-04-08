import express from "express";
import path from "path";
import { fileURLToPath } from "url";
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
