import path from 'path';
import fs from 'fs';

// In-memory fallback vector store
type InMemoryDocument = {
  id: string;
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
};

const inMemoryStore: InMemoryDocument[] = [];

// Cosine similarity function
const cosineSimilarity = (vecA: number[], vecB: number[]): number => {
  if (vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
};

// Lazy load vectordb to handle cases where native library isn't available
let lancedb: any = null;
let lancedbLoadError: Error | null = null;
let vectordbAvailable = false;
let useInMemoryStore = false;

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
      console.warn('LanceDB not available, falling back to in-memory vector store');
      console.warn('Error details:', lancedbLoadError?.message || 'Unknown error');
      useInMemoryStore = true;
      console.log('Using in-memory vector store (data will not persist between cold starts)');
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
    useInMemoryStore = false;
  } catch (error) {
    console.error('Failed to initialize LanceDB:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : String(error));
    console.warn('Falling back to in-memory vector store');
    vectordbAvailable = false;
    db = null;
    table = null;
    useInMemoryStore = true;
  }
};

export const addDocuments = async (documents: DocumentInput[]): Promise<void> => {
  if (documents.length === 0) {
    console.log('No documents to add');
    return;
  }

  // Initialize if needed
  if (!db && !useInMemoryStore) {
    console.log('DB not initialized, attempting to initialize...');
    try {
      await initVectorStore();
    } catch (error) {
      console.error('Cannot initialize vector store:', error);
      useInMemoryStore = true;
    }
  }

  // Use in-memory store if LanceDB is not available
  if (useInMemoryStore || !db) {
    console.log(`Adding ${documents.length} documents to in-memory vector store...`);
    for (const doc of documents) {
      inMemoryStore.push({
        id: doc.id,
        text: doc.text,
        embedding: doc.embedding,
        metadata: doc.metadata || {},
      });
    }
    console.log(`Added ${documents.length} documents to in-memory store. Total documents: ${inMemoryStore.length}`);
    return;
  }

  console.log(`Preparing to add ${documents.length} documents to LanceDB...`);

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
  // Use in-memory store if LanceDB is not available
  if (useInMemoryStore || !table) {
    if (inMemoryStore.length === 0) {
      console.warn('In-memory vector store is empty.');
      return [];
    }

    console.log(`Searching in-memory store with ${inMemoryStore.length} documents...`);
    
    // Calculate similarity scores for all documents
    const scoredDocs = inMemoryStore.map((doc) => ({
      ...doc,
      score: cosineSimilarity(queryEmbedding, doc.embedding),
    }));

    // Sort by score (descending) and take top K
    const results = scoredDocs
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((doc): SearchResult => ({
        id: doc.id,
        text: doc.text,
        score: doc.score,
        metadata: {
          title: doc.metadata.title as string,
          link: doc.metadata.link as string,
          pubDate: doc.metadata.pubDate as string,
          source: doc.metadata.source as string,
        },
      }));

    console.log(`Found ${results.length} results from in-memory store`);
    return results;
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

