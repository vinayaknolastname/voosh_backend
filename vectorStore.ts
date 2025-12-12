import path from 'path';
import fs from 'fs';
// LanceDB package currently ships without rich TS types; treat as any
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lancedb = require('vectordb');

type DocumentInput = {
  id: string;
  text: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
};

export type SearchResult = {
  id: string;
  text: string;
  score: number;
  metadata: {
    title?: string;
    link?: string;
    pubDate?: string;
    source?: string;
    [key: string]: unknown;
  };
};

type LanceDB = {
  connect: (dir: string) => Promise<any>;
};

let db: any = null;
let table: any = null;

// const DB_DIR = path.join(__dirname, '.lancedb'); // for local
const DB_DIR = '/tmp/lancedb';

export const initVectorStore = async (): Promise<void> => {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }

    db = await (lancedb as LanceDB).connect(DB_DIR);

    const tableNames: string[] = await db.tableNames();
    if (tableNames.includes('news_articles')) {
      table = await db.openTable('news_articles');
      console.log('Opened existing LanceDB table: news_articles');
    } else {
      console.log('LanceDB table news_articles does not exist yet. It will be created on first ingestion.');
    }
  } catch (error) {
    console.error('Failed to initialize LanceDB:', error);
  }
};

export const addDocuments = async (documents: DocumentInput[]): Promise<void> => {
  if (!db) await initVectorStore();
  if (documents.length === 0) return;

  const data = documents.map((doc) => ({
    id: doc.id,
    text: doc.text,
    vector: doc.embedding,
    ...(doc.metadata ?? {}), // flatten metadata into columns
  }));

  try {
    if (!table) {
      table = await db.createTable('news_articles', data);
      console.log(`Created LanceDB table with ${data.length} documents.`);
    } else {
      await table.add(data);
      console.log(`Added ${data.length} documents to LanceDB.`);
    }
  } catch (error) {
    console.error('Error adding documents to LanceDB:', error);
  }
};

export const search = async (queryEmbedding: number[], topK = 3): Promise<SearchResult[]> => {
  if (!table) {
    console.warn('Vector store is empty or not initialized.');
    return [];
  }

  try {
    const results = await table.search(queryEmbedding).limit(topK).execute();
    return results.map(
      (r: any): SearchResult => ({
        id: r.id,
        text: r.text,
        score: r._distance ? 1 - r._distance : 0,
        metadata: {
          title: r.title,
          link: r.link,
          pubDate: r.pubDate,
          source: r.source,
        },
      }),
    );
  } catch (error) {
    console.error('Error searching LanceDB:', error);
    return [];
  }
};

export const clearStore = async (): Promise<void> => {
  if (table && db) {
    try {
      await db.dropTable('news_articles');
      table = null;
      console.log('Dropped LanceDB table.');
    } catch (error) {
      console.error('Error clearing store:', error);
    }
  }
};

export default {
  initVectorStore,
  addDocuments,
  search,
  clearStore,
};

