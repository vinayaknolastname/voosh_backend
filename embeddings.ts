import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error('GEMINI_API_KEY is not set in environment variables');
}

const genAI = new GoogleGenerativeAI(apiKey);
const model: GenerativeModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });

export const generateEmbeddings = async (text: string): Promise<number[] | null> => {
  try {
    const result = await model.embedContent(text);
    const embedding = result.embedding;
    return embedding.values;
  } catch (error) {
    console.error('Error generating embedding:', error);
    return null;
  }
};

export const generateBatchEmbeddings = async (
  texts: string[],
  delayMs: number = 100,
): Promise<number[][]> => {
  const embeddings: number[][] = [];

  for (const text of texts) {
    const emb = await generateEmbeddings(text);
    if (emb) embeddings.push(emb);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return embeddings;
};

export default generateEmbeddings;

