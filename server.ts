import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

import { initRedis, getClient } from './redisClient';
import { ingestNews, Article } from './ingest';
import { generateEmbeddings } from './embeddings';
import { initVectorStore, addDocuments, search, SearchResult } from './vectorStore';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Initialize Gemini for Chat
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');
const chatModel: GenerativeModel = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  systemInstruction: {
    parts: [
      {
        text: `You are a helpful news assistant. Answer based ONLY on context. Do NOT start your answer with "Based on the context provided" or similar phrases. Just answer the question directly.`,
      },
    ],
    role: 'model',
  },
});

type ChatHistoryItem = {
  role: 'user' | 'assistant';
  content: string;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let isInitialized = false;

// Initialize System (lazy initialization for serverless)
const initializeSystem = async (): Promise<void> => {
  if (isInitialized) {
    console.log('System already initialized, skipping...');
    return;
  }
  
  console.log('Starting system initialization...');
  isInitialized = true;
  
  await initRedis();
  console.log('Redis initialized');
  
  await initVectorStore();
  console.log('Vector store initialization attempted');

  try {
    const articles: Article[] = await ingestNews();
    console.log(`Ingested ${articles.length} articles. Generating embeddings...`);

    let addedCount = 0;
    for (const article of articles) {
      const textToEmbed = `${article.title}. ${article.content}`;
      const embedding = await generateEmbeddings(textToEmbed);
      if (embedding) {
        await addDocuments([
          {
            id: uuidv4(),
            text: textToEmbed,
            embedding,
            metadata: article,
          },
        ]);
        addedCount++;
      }
      await delay(200);
    }
    console.log(`System initialization complete. Added ${addedCount} documents to vector store.`);
  } catch (error) {
    console.error('Initialization failed:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : String(error));
  }
};

// Initialize on first request (for serverless)
app.use(async (_req, _res, next) => {
  await initializeSystem();
  next();
});

// --- Routes ---

app.post('/api/session', (_req: Request, res: Response) => {
  const sessionId = uuidv4();
  res.json({ sessionId });
});

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).send('OK');
});

app.post('/api/chat', async (req: Request, res: Response) => {
  const { sessionId, message } = req.body as { sessionId?: string; message?: string };

  console.log('Received message:', message);

  if (!sessionId || !message) {
    return res.status(400).json({ error: 'Missing sessionId or message' });
  }

  try {
    const queryEmbedding = await generateEmbeddings(message);
    let context = '';
    let sources: SearchResult['metadata'][] = [];

    if (queryEmbedding) {
      const results = await search(queryEmbedding, 3);
      context = results.map((r) => r.text).join('\n\n');
      sources = results.map((r) => r.metadata);
    }

    console.log('Query Embedding:', queryEmbedding);

    const redisClient = getClient();
    let history: ChatHistoryItem[] = [];
    if (redisClient) {
      const historyStr = await redisClient.get(`session:${sessionId}`);
      if (typeof historyStr === 'string') {
        history = JSON.parse(historyStr) as ChatHistoryItem[];
      }
    }

    const chat = chatModel.startChat({
      history: history.map((h) => ({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.content }],
      })),
    });

    const finalPrompt = `Context:\n${context}\n\nQuestion: ${message}`;
    const result = await chat.sendMessage(finalPrompt);
    const responseText = result.response.text();

    const newHistory: ChatHistoryItem[] = [
      ...history,
      { role: 'user', content: message },
      { role: 'assistant', content: responseText },
    ];

    if (redisClient) {
      await redisClient.set(`session:${sessionId}`, JSON.stringify(newHistory), {
        EX: 3600,
      });
    }
    console.log('Response:', responseText);

    res.json({ answer: responseText, sources });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/history/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const redisClient = getClient();

  if (!redisClient) {
    return res.json({ history: [] });
  }

  const historyStr = await redisClient.get(`session:${sessionId}`);
  res.json({ history: typeof historyStr === 'string' ? (JSON.parse(historyStr) as ChatHistoryItem[]) : [] });
});

app.delete('/api/session/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const redisClient = getClient();

  if (redisClient) {
    await redisClient.del(`session:${sessionId}`);
  }

  res.json({ message: 'Session cleared' });
});

// Only listen if not in serverless environment
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

export default app;

