
import { GoogleGenAI } from "@google/genai";

// A chave GEMINI_API_KEY é injetada automaticamente no ambiente do frontend pelo AI Studio.
// O SDK espera que ela esteja disponível em process.env.GEMINI_API_KEY.
const ai = new GoogleGenAI({ apiKey: (process.env as any).GEMINI_API_KEY || "" });

export const professionalizeText = async (text: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Melhore o seguinte texto para torná-lo mais profissional, claro e conciso, mantendo o sentido original. O texto é uma observação técnica ou lembrete de uma agenda de montagem de móveis:\n\n"${text}"`
    });
    
    return response.text || "";
  } catch (error) {
    console.error("Erro ao profissionalizar texto com Gemini:", error);
    throw error;
  }
};

export const analyzeLabel = async (base64Image: string, customPrompt?: string): Promise<string> => {
  try {
    const prompt = customPrompt || "Extraia os dados técnicos desta etiqueta de móveis. Retorne um array JSON: [ { \"label\": \"CAMPO\", \"value\": \"VALOR\" } ]";
    
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
    console.error("Erro ao analisar etiqueta com Gemini:", error);
    throw error;
  }
};
