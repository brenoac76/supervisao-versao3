
import { GoogleGenAI } from "@google/genai";
import { safeJSONFetch } from '../../utils/api';

// A chave GEMINI_API_KEY é injetada automaticamente no ambiente do frontend pelo AI Studio.
// O SDK espera que ela esteja disponível em process.env.GEMINI_API_KEY.
const apiKey = process.env.GEMINI_API_KEY || "";
let ai: GoogleGenAI | null = null;

if (apiKey && apiKey.length > 10) {
  ai = new GoogleGenAI({ apiKey });
}

export const professionalizeText = async (text: string): Promise<string> => {
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Melhore o seguinte texto para torná-lo mais profissional, claro e conciso, mantendo o sentido original. O texto é uma observação técnica ou lembrete de uma agenda de montagem de móveis:\n\n"${text}"`
      });
      
      return response.text || "";
    } catch (error) {
      console.warn("Erro ao profissionalizar texto com Gemini no frontend, tentando fallback para o backend...", error);
      // Fallback para o backend em caso de erro (ex: chave inválida)
    }
  }

  // Fallback para o backend (Vertex AI sem API Key)
  const res = await fetch('/api/ai/professionalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("Rota da API não encontrada (404). Se você está no link externo, por favor, publique (Deploy) o app novamente para atualizar o servidor.");
    }
    const errorData = await safeJSONFetch(res).catch(() => ({}));
    throw new Error(errorData.error || `Falha no servidor (${res.status})`);
  }
  
  const data = await safeJSONFetch(res);
  return data.text;
};

export const analyzeLabel = async (base64Image: string, customPrompt?: string): Promise<string> => {
  const prompt = customPrompt || "Extraia os dados técnicos desta etiqueta de móveis. Retorne um array JSON: [ { \"label\": \"CAMPO\", \"value\": \"VALOR\" } ]";
  
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Image
              }
            }
          ]
        }
      });
      
      return response.text || "";
    } catch (error) {
      console.warn("Erro ao analisar etiqueta com Gemini no frontend, tentando fallback para o backend...", error);
      // Fallback para o backend
    }
  }

  // Fallback para o backend (Vertex AI sem API Key)
  const res = await fetch('/api/ai/analyze-label', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Image, prompt })
  });
  
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("Rota da API não encontrada (404). Se você está no link externo, por favor, publique (Deploy) o app novamente para atualizar o servidor.");
    }
    const errorData = await safeJSONFetch(res).catch(() => ({}));
    throw new Error(errorData.error || `Falha no servidor (${res.status})`);
  }
  
  const data = await safeJSONFetch(res);
  return data.text;
};
