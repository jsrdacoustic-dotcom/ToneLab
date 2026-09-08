import { GoogleGenAI, Type } from "@google/genai";
import { AIInsight } from '../types';

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.error("API Key missing");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export const getFrequencyInsight = async (frequency: number): Promise<AIInsight | null> => {
  const ai = getClient();
  if (!ai) return null;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Explain the significance of the audio frequency ${frequency}Hz. 
      What instruments or sounds reside here? How is it used in audio testing?`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "A short, catchy title about this frequency range (e.g. 'Sub-Bass Rumble')" },
            description: { type: Type.STRING, description: "A concise 2-sentence explanation of its characteristics and usage." }
          },
          required: ["title", "description"]
        }
      }
    });

    const text = response.text;
    if (!text) return null;
    return JSON.parse(text) as AIInsight;
  } catch (error) {
    console.error("Gemini API Error:", error);
    return null;
  }
};