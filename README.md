# RAG Chatbot Backend

A Node.js Express backend for a RAG-powered news chatbot.

## Features
- **News Ingestion**: Fetches news from RSS feeds (BBC, Reuters, NYT).
- **RAG Pipeline**: 
    - Generates embeddings using Google Gemini API.
    - Stores embeddings in an in-memory vector store.
    - Retrieves relevant context for user queries.
- **Chat API**: Integrates with Google Gemini for answering questions based on retrieved context.
- **Session Management**: Uses Redis (with in-memory fallback) to store chat history.

## Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Variables**:
   Create a `.env` file in the root directory:
   ```env
   PORT=3000
   GEMINI_API_KEY=your_gemini_api_key
   REDIS_URL=redis://localhost:6379  # Optional
   ```

3. **Run Server**:
   ```bash
   npm start
   ```
   The server will start on `http://localhost:3000`. It will automatically ingest news articles on startup.

## API Endpoints

- `POST /api/session`: Create a new session.
- `POST /api/chat`: Send a message. Body: `{ sessionId, message }`.
- `GET /api/history/:sessionId`: Get chat history.
- `DELETE /api/session/:sessionId`: Clear session history.
