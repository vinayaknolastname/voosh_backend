import path from 'path';
import fs from 'fs';

// Lazy load vectordb to handle cases where native library isn't available
let lancedb: any = null;
let lancedbLoadError: Error | null = null;
let vectordbAvailable = false;

const loadLanceDB = async (): Promise<any> => {
  if (lancedb) return lancedb;
  if (lancedbLoadError) {
    return null; // Return null instead of throwing
  }
  
  try {
    // Use dynamic import to defer loading until actually needed
    // This prevents the module from being evaluated at module load time
    const vectordbModule = await import('vectordb');
    lancedb = vectordbModule.default || vectordbModule;
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
    console.log('Attempting to load LanceDB...');
    const lancedbModule = await loadLanceDB();
    if (!lancedbModule || !vectordbAvailable) {
      console.warn('LanceDB not available, vector store will be disabled');
      console.warn('Error details:', lancedbLoadError?.message || 'Unknown error');
      return;
    }

    console.log('LanceDB module loaded successfully');
    
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
      console.log(`Created directory: ${DB_DIR}`);
    }

    console.log('Connecting to LanceDB...');
    db = await (lancedbModule as LanceDB).connect(DB_DIR);
    console.log('Connected to LanceDB successfully');

    const tableNames: string[] = await db.tableNames();
    console.log('Existing tables:', tableNames);
    
    if (tableNames.includes('news_articles')) {
      table = await db.openTable('news_articles');
      console.log('Opened existing LanceDB table: news_articles');
    } else {
      console.log('LanceDB table news_articles does not exist yet. It will be created on first ingestion.');
    }
  } catch (error) {
    console.error('Failed to initialize LanceDB:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : String(error));
    console.warn('Vector store will be disabled. Search functionality may not work.');
    vectordbAvailable = false;
    db = null;
    table = null;
  }
};

export const addDocuments = async (documents: DocumentInput[]): Promise<void> => {
  if (documents.length === 0) {
    console.log('No documents to add');
    return;
  }

  if (!db) {
    console.log('DB not initialized, attempting to initialize...');
    try {
      await initVectorStore();
    } catch (error) {
      console.error('Cannot initialize vector store, skipping document addition:', error);
      return;
    }
  }
  
  if (!db) {
    console.warn('DB is still null after initialization attempt. Vector store unavailable.');
    return;
  }

  console.log(`Preparing to add ${documents.length} documents to vector store...`);

  const data = documents.map((doc) => ({
    id: doc.id,
    text: doc.text,
    vector: doc.embedding,
    ...(doc.metadata ?? {}), // flatten metadata into columns
  }));

  try {
    if (!table) {
      console.log('Creating new LanceDB table with documents...');
      table = await db.createTable('news_articles', data);
      console.log(`Created LanceDB table with ${data.length} documents.`);
    } else {
      console.log('Adding documents to existing table...');
      await table.add(data);
      console.log(`Added ${data.length} documents to LanceDB.`);
    }
  } catch (error) {
    console.error('Error adding documents to LanceDB:', error);
    console.error('Error details:', error instanceof Error ? error.stack : String(error));
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

