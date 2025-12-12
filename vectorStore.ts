import path from 'path';
import fs from 'fs';

// Lazy load vectordb to handle cases where native library isn't available
let lancedb: any = null;
let lancedbLoadError: Error | null = null;
let vectordbAvailable = false;

const loadLanceDB = (): any => {
  if (lancedb) return lancedb;
  if (lancedbLoadError) {
    return null; // Return null instead of throwing
  }
  
  try {
    // Use require for CommonJS compatibility
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    lancedb = require('vectordb');
    vectordbAvailable = true;
    return lancedb;
  } catch (error) {
    lancedbLoadError = error as Error;
    vectordbAvailable = false;
    console.error('Failed to load vectordb native library:', error);
    console.warn('Vector store functionality will be disabled');
    return null; // Return null instead of throwing
  }
};

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
    const lancedbModule = loadLanceDB();
    if (!lancedbModule || !vectordbAvailable) {
      console.warn('LanceDB not available, vector store will be disabled');
      return;
    }

    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }

    db = await (lancedbModule as LanceDB).connect(DB_DIR);

    const tableNames: string[] = await db.tableNames();
    if (tableNames.includes('news_articles')) {
      table = await db.openTable('news_articles');
      console.log('Opened existing LanceDB table: news_articles');
    } else {
      console.log('LanceDB table news_articles does not exist yet. It will be created on first ingestion.');
    }
  } catch (error) {
    console.error('Failed to initialize LanceDB:', error);
    console.warn('Vector store will be disabled. Search functionality may not work.');
    vectordbAvailable = false;
  }
};

export const addDocuments = async (documents: DocumentInput[]): Promise<void> => {
  if (!db) {
    try {
      await initVectorStore();
    } catch (error) {
      console.warn('Cannot initialize vector store, skipping document addition');
      return;
    }
  }
  
  if (documents.length === 0 || !db) return;

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

