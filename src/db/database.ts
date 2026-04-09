import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import * as crypto from 'crypto';
import {
  NoteMetadata,
  NoteConnection,
  KnowledgeGap,
  UsageRecord,
  UsageSummary,
  RelationType,
  GapPriority,
  ProviderType,
  SearchResult,
} from '../types';

// ============================================
// Database Schema (without sqlite-vec)
// ============================================

const SCHEMA = `
-- Notes metadata table
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  title TEXT,
  content_hash TEXT,
  word_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  embedding_id INTEGER,
  last_analyzed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_notes_path ON notes(path);
CREATE INDEX IF NOT EXISTS idx_notes_content_hash ON notes(content_hash);

-- Note embeddings table (using BLOB for pure JS storage)
CREATE TABLE IF NOT EXISTS note_embeddings (
  id INTEGER PRIMARY KEY,
  embedding BLOB NOT NULL
);

-- Connections between notes
CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_note_id INTEGER NOT NULL,
  target_note_id INTEGER NOT NULL,
  relation_type TEXT NOT NULL CHECK(relation_type IN ('extends', 'supports', 'contradicts', 'examples', 'related')),
  confidence REAL DEFAULT 0.5 CHECK(confidence >= 0 AND confidence <= 1),
  reasoning TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_note_id) REFERENCES notes(id) ON DELETE CASCADE,
  UNIQUE(source_note_id, target_note_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_connections_source ON connections(source_note_id);
CREATE INDEX IF NOT EXISTS idx_connections_target ON connections(target_note_id);

-- Knowledge gaps identified
CREATE TABLE IF NOT EXISTS knowledge_gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL,
  topic TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL CHECK(priority IN ('high', 'medium', 'low')),
  suggested_resources TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gaps_note ON knowledge_gaps(note_id);
CREATE INDEX IF NOT EXISTS idx_gaps_priority ON knowledge_gaps(priority);

-- API usage logging
CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  provider TEXT NOT NULL CHECK(provider IN ('gemini', 'claude', 'openai', 'xai', 'ollama')),
  model TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('generation', 'embedding', 'analysis', 'draft', 'indexing')),
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  job_id TEXT,
  note_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_log(provider);

-- Response cache for cost optimization
CREATE TABLE IF NOT EXISTS response_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key TEXT UNIQUE NOT NULL,
  response TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  hit_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cache_key ON response_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON response_cache(expires_at);

-- Embedding cache for avoiding redundant API calls
CREATE TABLE IF NOT EXISTS embedding_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_hash TEXT UNIQUE NOT NULL,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_embedding_hash ON embedding_cache(content_hash);

-- Job queue for async operations
CREATE TABLE IF NOT EXISTS job_queue (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  progress INTEGER DEFAULT 0,
  data TEXT,
  result TEXT,
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME,
  estimated_cost REAL,
  actual_cost REAL
);

CREATE INDEX IF NOT EXISTS idx_job_status ON job_queue(status);
`;

// ============================================
// Vector Math Utilities (Pure JavaScript)
// ============================================

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

function embeddingToBlob(embedding: number[]): Uint8Array {
  const buffer = new ArrayBuffer(embedding.length * 4);
  const view = new Float32Array(buffer);
  for (let i = 0; i < embedding.length; i++) {
    view[i] = embedding[i];
  }
  return new Uint8Array(buffer);
}

function blobToEmbedding(blob: Uint8Array): number[] {
  const buffer = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
  const view = new Float32Array(buffer);
  return Array.from(view);
}

// ============================================
// Database Class
// ============================================

export class OSBADatabase {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;
  private saveCallback: ((data: Uint8Array) => Promise<void>) | null = null;
  private loadCallback: (() => Promise<Uint8Array | null>) | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  // Set callbacks for persistence (Obsidian adapter)
  setSaveCallback(callback: (data: Uint8Array) => Promise<void>): void {
    this.saveCallback = callback;
  }

  setLoadCallback(callback: () => Promise<Uint8Array | null>): void {
    this.loadCallback = callback;
  }

  async initialize(): Promise<void> {
    try {
      // Initialize sql.js
      const SQL = await initSqlJs({
        // sql.js WASM will be loaded from CDN or bundled
        locateFile: (file: string) => `https://sql.js.org/dist/${file}`
      });

      // Try to load existing database
      let existingData: Uint8Array | null = null;
      if (this.loadCallback) {
        existingData = await this.loadCallback();
      }

      if (existingData) {
        this.db = new SQL.Database(existingData);
        console.log('OSBA Database loaded from existing file');
      } else {
        this.db = new SQL.Database();
        console.log('OSBA Database created new instance');
      }

      // Run schema (CREATE IF NOT EXISTS is safe)
      this.db.run(SCHEMA);

      // Perform migrations
      await this.migrate();

      // Save initial state
      await this.save();

      console.log('OSBA Database initialized successfully');

    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  private async migrate(): Promise<void> {
    const db = this.ensureDb();

    // Check current version
    const versionResult = db.exec('PRAGMA user_version');
    const version = (versionResult.length > 0 && versionResult[0].values.length > 0)
      ? versionResult[0].values[0][0] as number
      : 0;

    if (version < 2) {
      console.log('Migrating database to version 2...');

      try {
        db.run('BEGIN TRANSACTION');

        // Rename old table
        db.run('ALTER TABLE usage_log RENAME TO usage_log_old');

        // Create new table with updated CHECK constraints
        db.run(`
          CREATE TABLE usage_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            provider TEXT NOT NULL CHECK(provider IN ('gemini', 'claude', 'openai', 'xai', 'ollama')),
            model TEXT NOT NULL,
            operation TEXT NOT NULL CHECK(operation IN ('generation', 'embedding', 'analysis', 'draft', 'indexing')),
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            cost REAL DEFAULT 0,
            job_id TEXT,
            note_path TEXT
          )
        `);

        // Create indexes
        db.run('CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_log(timestamp)');
        db.run('CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_log(provider)');

        // Copy data
        db.run('INSERT INTO usage_log SELECT * FROM usage_log_old');

        // Drop old table
        db.run('DROP TABLE usage_log_old');

        // Update version
        db.run('PRAGMA user_version = 2');

        db.run('COMMIT');

        console.log('Database migration to version 2 completed');
      } catch (error) {
        db.run('ROLLBACK');
        console.error('Migration failed:', error);
        throw error;
      }
    }
  }

  async save(): Promise<void> {
    if (this.db && this.saveCallback) {
      const data = this.db.export();
      await this.saveCallback(data);
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.save();
      this.db.close();
      this.db = null;
    }
  }

  private ensureDb(): SqlJsDatabase {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  // ============================================
  // Notes Operations
  // ============================================

  async upsertNote(
    path: string,
    title: string,
    content: string
  ): Promise<number> {
    const db = this.ensureDb();
    const contentHash = this.hashContent(content);
    const wordCount = content.split(/\s+/).length;

    // Check if exists
    const existing = db.exec('SELECT id FROM notes WHERE path = ?', [path]);

    if (existing.length > 0 && existing[0].values.length > 0) {
      // Update
      db.run(
        `UPDATE notes SET title = ?, content_hash = ?, word_count = ?, modified_at = datetime('now')
         WHERE path = ?`,
        [title, contentHash, wordCount, path]
      );
      await this.save();
      return existing[0].values[0][0] as number;
    } else {
      // Insert
      db.run(
        `INSERT INTO notes (path, title, content_hash, word_count, modified_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        [path, title, contentHash, wordCount]
      );
      await this.save();

      const result = db.exec('SELECT last_insert_rowid()');
      return result[0].values[0][0] as number;
    }
  }

  async getNoteByPath(path: string): Promise<NoteMetadata | null> {
    const db = this.ensureDb();
    const result = db.exec('SELECT * FROM notes WHERE path = ?', [path]);

    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.mapNoteRow(result[0].columns, result[0].values[0]);
  }

  async getNoteById(id: number): Promise<NoteMetadata | null> {
    const db = this.ensureDb();
    const result = db.exec('SELECT * FROM notes WHERE id = ?', [id]);

    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.mapNoteRow(result[0].columns, result[0].values[0]);
  }

  async deleteNote(path: string): Promise<void> {
    const db = this.ensureDb();
    db.run('DELETE FROM notes WHERE path = ?', [path]);
    await this.save();
  }

  async updateNotePath(oldPath: string, newPath: string): Promise<void> {
    const db = this.ensureDb();
    db.run('UPDATE notes SET path = ? WHERE path = ?', [newPath, oldPath]);
    await this.save();
  }

  async hasContentChanged(path: string, content: string): Promise<boolean> {
    const db = this.ensureDb();
    const newHash = this.hashContent(content);
    const result = db.exec('SELECT content_hash FROM notes WHERE path = ?', [path]);

    if (result.length === 0 || result[0].values.length === 0) return true;

    return result[0].values[0][0] !== newHash;
  }

  private mapNoteRow(columns: string[], values: any[]): NoteMetadata {
    const row: Record<string, any> = {};
    columns.forEach((col, i) => {
      row[col] = values[i];
    });

    return {
      id: row.id,
      path: row.path,
      title: row.title,
      contentHash: row.content_hash,
      wordCount: row.word_count,
      createdAt: new Date(row.created_at),
      modifiedAt: new Date(row.modified_at),
      embeddingId: row.embedding_id,
      lastAnalyzedAt: row.last_analyzed_at ? new Date(row.last_analyzed_at) : undefined,
    };
  }

  // ============================================
  // Embedding Operations (Pure JavaScript)
  // ============================================

  async storeEmbedding(noteId: number, embedding: number[]): Promise<number> {
    const db = this.ensureDb();
    const blob = embeddingToBlob(embedding);

    // Check if exists
    const existing = db.exec('SELECT id FROM note_embeddings WHERE id = ?', [noteId]);

    if (existing.length > 0 && existing[0].values.length > 0) {
      db.run('UPDATE note_embeddings SET embedding = ? WHERE id = ?', [blob, noteId]);
    } else {
      db.run('INSERT INTO note_embeddings (id, embedding) VALUES (?, ?)', [noteId, blob]);
    }

    // Update note with embedding reference
    db.run('UPDATE notes SET embedding_id = ? WHERE id = ?', [noteId, noteId]);

    await this.save();
    return noteId;
  }

  async findSimilar(
    embedding: number[],
    limit: number = 10,
    excludeNoteId?: number
  ): Promise<SearchResult[]> {
    const db = this.ensureDb();

    // Get all embeddings
    let query = `
      SELECT e.id, e.embedding, n.path, n.title
      FROM note_embeddings e
      JOIN notes n ON e.id = n.id
    `;

    if (excludeNoteId) {
      query += ` WHERE n.id != ${excludeNoteId}`;
    }

    const result = db.exec(query);

    if (result.length === 0 || result[0].values.length === 0) {
      return [];
    }

    // Calculate similarities in JavaScript
    const similarities: { path: string; title: string; similarity: number }[] = [];

    for (const row of result[0].values) {
      const storedEmbedding = blobToEmbedding(row[1] as Uint8Array);
      const similarity = cosineSimilarity(embedding, storedEmbedding);

      similarities.push({
        path: row[2] as string,
        title: row[3] as string,
        similarity,
      });
    }

    // Sort by similarity descending and take top N
    similarities.sort((a, b) => b.similarity - a.similarity);

    return similarities.slice(0, limit).map(item => ({
      notePath: item.path,
      title: item.title,
      similarity: item.similarity,
    }));
  }

  async getCachedEmbedding(contentHash: string): Promise<number[] | null> {
    const db = this.ensureDb();
    const result = db.exec(
      'SELECT embedding FROM embedding_cache WHERE content_hash = ?',
      [contentHash]
    );

    if (result.length === 0 || result[0].values.length === 0) return null;

    return blobToEmbedding(result[0].values[0][0] as Uint8Array);
  }

  async cacheEmbedding(contentHash: string, embedding: number[], model: string): Promise<void> {
    const db = this.ensureDb();
    const blob = embeddingToBlob(embedding);

    db.run(
      `INSERT OR REPLACE INTO embedding_cache (content_hash, embedding, model, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [contentHash, blob, model]
    );

    await this.save();
  }

  // ============================================
  // Connection Operations
  // ============================================

  async storeConnections(
    sourceNoteId: number,
    connections: {
      targetNoteId: number;
      relationType: RelationType;
      confidence: number;
      reasoning: string;
    }[]
  ): Promise<void> {
    const db = this.ensureDb();

    // Clear existing connections for this source
    db.run('DELETE FROM connections WHERE source_note_id = ?', [sourceNoteId]);

    // Insert new connections
    for (const conn of connections) {
      db.run(
        `INSERT INTO connections (source_note_id, target_note_id, relation_type, confidence, reasoning)
         VALUES (?, ?, ?, ?, ?)`,
        [sourceNoteId, conn.targetNoteId, conn.relationType, conn.confidence, conn.reasoning]
      );
    }

    await this.save();
  }

  async getConnectionsForNote(noteId: number): Promise<NoteConnection[]> {
    const db = this.ensureDb();
    const result = db.exec(
      `SELECT * FROM connections
       WHERE source_note_id = ? OR target_note_id = ?
       ORDER BY confidence DESC`,
      [noteId, noteId]
    );

    if (result.length === 0 || result[0].values.length === 0) return [];

    return result[0].values.map((row: unknown[]) => {
      const obj: Record<string, unknown> = {};
      result[0].columns.forEach((col: string, i: number) => {
        obj[col] = row[i];
      });

      return {
        id: obj.id as number,
        sourceNoteId: obj.source_note_id as number,
        targetNoteId: obj.target_note_id as number,
        relationType: obj.relation_type as RelationType,
        confidence: obj.confidence as number,
        reasoning: obj.reasoning as string | undefined,
        createdAt: new Date(obj.created_at as string),
      };
    });
  }

  // ============================================
  // Knowledge Gap Operations
  // ============================================

  async storeGaps(
    noteId: number,
    gaps: {
      topic: string;
      description: string;
      priority: GapPriority;
      suggestedResources?: string[];
    }[]
  ): Promise<void> {
    const db = this.ensureDb();

    // Clear existing gaps for this note
    db.run('DELETE FROM knowledge_gaps WHERE note_id = ?', [noteId]);

    // Insert new gaps
    for (const gap of gaps) {
      db.run(
        `INSERT INTO knowledge_gaps (note_id, topic, description, priority, suggested_resources)
         VALUES (?, ?, ?, ?, ?)`,
        [
          noteId,
          gap.topic,
          gap.description,
          gap.priority,
          gap.suggestedResources ? JSON.stringify(gap.suggestedResources) : null
        ]
      );
    }

    await this.save();
  }

  async getGapsForNote(noteId: number): Promise<KnowledgeGap[]> {
    const db = this.ensureDb();
    const result = db.exec('SELECT * FROM knowledge_gaps WHERE note_id = ?', [noteId]);

    if (result.length === 0 || result[0].values.length === 0) return [];

    return result[0].values.map((row: unknown[]) => {
      const obj: Record<string, unknown> = {};
      result[0].columns.forEach((col: string, i: number) => {
        obj[col] = row[i];
      });

      return {
        id: obj.id as number,
        noteId: obj.note_id as number,
        topic: obj.topic as string,
        description: obj.description as string | undefined,
        priority: obj.priority as GapPriority,
        suggestedResources: obj.suggested_resources ? JSON.parse(obj.suggested_resources as string) : undefined,
        createdAt: new Date(obj.created_at as string),
      };
    });
  }

  async getAllGapsByPriority(priority?: GapPriority): Promise<KnowledgeGap[]> {
    const db = this.ensureDb();

    let query = 'SELECT * FROM knowledge_gaps';
    const params: any[] = [];

    if (priority) {
      query += ' WHERE priority = ?';
      params.push(priority);
    }

    query += ' ORDER BY priority DESC, created_at DESC';

    const result = db.exec(query, params);

    if (result.length === 0 || result[0].values.length === 0) return [];

    return result[0].values.map((row: unknown[]) => {
      const obj: Record<string, unknown> = {};
      result[0].columns.forEach((col: string, i: number) => {
        obj[col] = row[i];
      });

      return {
        id: obj.id as number,
        noteId: obj.note_id as number,
        topic: obj.topic as string,
        description: obj.description as string | undefined,
        priority: obj.priority as GapPriority,
        suggestedResources: obj.suggested_resources ? JSON.parse(obj.suggested_resources as string) : undefined,
        createdAt: new Date(obj.created_at as string),
      };
    });
  }

  // ============================================
  // Usage Logging Operations
  // ============================================

  async logUsage(usage: Omit<UsageRecord, 'id' | 'timestamp'>): Promise<void> {
    const db = this.ensureDb();

    db.run(
      `INSERT INTO usage_log (provider, model, operation, input_tokens, output_tokens, cost, job_id, note_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        usage.provider,
        usage.model,
        usage.operation,
        usage.inputTokens,
        usage.outputTokens,
        usage.cost,
        usage.jobId || null,
        usage.notePath || null
      ]
    );

    await this.save();
  }

  async getUsageSummary(period: 'day' | 'week' | 'month' | 'all'): Promise<UsageSummary> {
    const db = this.ensureDb();

    let startDate: Date;
    const endDate = new Date();
    const isAllTime = period === 'all';

    switch (period) {
      case 'day':
        startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
        startDate = new Date(0);
        break;
    }

    const startDateStr = startDate.toISOString();
    const whereClause = isAllTime ? '' : `WHERE timestamp >= '${startDateStr}'`;

    // Total cost and tokens
    const totalResult = db.exec(`
      SELECT COALESCE(SUM(cost), 0) as total,
             COUNT(*) as count,
             COALESCE(SUM(input_tokens + output_tokens), 0) as tokens
      FROM usage_log ${whereClause}
    `);

    const totalRow = totalResult.length > 0 && totalResult[0].values.length > 0
      ? { total: totalResult[0].values[0][0] as number, count: totalResult[0].values[0][1] as number, tokens: totalResult[0].values[0][2] as number }
      : { total: 0, count: 0, tokens: 0 };

    // By provider
    const providerResult = db.exec(`
      SELECT provider, COALESCE(SUM(cost), 0) as cost
      FROM usage_log ${whereClause}
      GROUP BY provider
    `);

    const byProvider: Record<ProviderType, number> = {} as Record<ProviderType, number>;
    if (providerResult.length > 0) {
      for (const row of providerResult[0].values) {
        byProvider[row[0] as ProviderType] = row[1] as number;
      }
    }

    // By model
    const modelResult = db.exec(`
      SELECT model, COALESCE(SUM(cost), 0) as cost
      FROM usage_log ${whereClause}
      GROUP BY model
    `);

    const byModel: Record<string, number> = {};
    if (modelResult.length > 0) {
      for (const row of modelResult[0].values) {
        byModel[row[0] as string] = row[1] as number;
      }
    }

    // By operation
    const opResult = db.exec(`
      SELECT operation, COALESCE(SUM(cost), 0) as cost
      FROM usage_log ${whereClause}
      GROUP BY operation
    `);

    const byOperation: Record<string, number> = {};
    if (opResult.length > 0) {
      for (const row of opResult[0].values) {
        byOperation[row[0] as string] = row[1] as number;
      }
    }

    return {
      period,
      startDate,
      endDate,
      totalCost: totalRow.total,
      totalRequests: totalRow.count,
      totalTokens: totalRow.tokens,
      byProvider,
      byModel,
      byOperation,
      requestCount: totalRow.count,
    };
  }

  async getTodaysCost(): Promise<number> {
    const db = this.ensureDb();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = db.exec(
      `SELECT COALESCE(SUM(cost), 0) as total
       FROM usage_log WHERE timestamp >= ?`,
      [today.toISOString()]
    );

    if (result.length === 0 || result[0].values.length === 0) return 0;
    return result[0].values[0][0] as number;
  }

  async getMonthsCost(): Promise<number> {
    const db = this.ensureDb();
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const result = db.exec(
      `SELECT COALESCE(SUM(cost), 0) as total
       FROM usage_log WHERE timestamp >= ?`,
      [startOfMonth.toISOString()]
    );

    if (result.length === 0 || result[0].values.length === 0) return 0;
    return result[0].values[0][0] as number;
  }

  // ============================================
  // Cache Operations
  // ============================================

  async getCachedResponse(cacheKey: string): Promise<string | null> {
    const db = this.ensureDb();
    const result = db.exec(
      `SELECT response FROM response_cache
       WHERE cache_key = ? AND expires_at > datetime('now')`,
      [cacheKey]
    );

    if (result.length === 0 || result[0].values.length === 0) return null;

    // Update hit count
    db.run(
      `UPDATE response_cache SET hit_count = hit_count + 1 WHERE cache_key = ?`,
      [cacheKey]
    );
    await this.save();

    return result[0].values[0][0] as string;
  }

  async cacheResponse(cacheKey: string, response: string, model: string, ttlSeconds: number): Promise<void> {
    const db = this.ensureDb();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    db.run(
      `INSERT OR REPLACE INTO response_cache (cache_key, response, model, expires_at)
       VALUES (?, ?, ?, ?)`,
      [cacheKey, response, model, expiresAt.toISOString()]
    );

    await this.save();
  }

  async cleanExpiredCache(): Promise<number> {
    const db = this.ensureDb();

    const beforeCount = db.exec('SELECT COUNT(*) FROM response_cache WHERE expires_at <= datetime("now")');
    const count = beforeCount.length > 0 && beforeCount[0].values.length > 0
      ? beforeCount[0].values[0][0] as number
      : 0;

    db.run(`DELETE FROM response_cache WHERE expires_at <= datetime('now')`);
    await this.save();

    return count;
  }

  // ============================================
  // Statistics
  // ============================================

  async getStats(): Promise<{
    totalNotes: number;
    indexedNotes: number;
    totalConnections: number;
    totalGaps: number;
    cacheHitRate: number;
    lastUpdated: Date | null;
  }> {
    const db = this.ensureDb();

    const notesResult = db.exec('SELECT COUNT(*) as count FROM notes');
    const indexedResult = db.exec('SELECT COUNT(*) as count FROM notes WHERE embedding_id IS NOT NULL');
    const connectionsResult = db.exec('SELECT COUNT(*) as count FROM connections');
    const gapsResult = db.exec('SELECT COUNT(*) as count FROM knowledge_gaps');
    const cacheResult = db.exec('SELECT SUM(hit_count) as hits, COUNT(*) as total FROM response_cache');
    const lastUpdatedResult = db.exec('SELECT MAX(modified_at) as last_updated FROM notes');

    const getValue = (result: any[], defaultVal: any = 0) => {
      if (result.length === 0 || result[0].values.length === 0) return defaultVal;
      return result[0].values[0][0] ?? defaultVal;
    };

    const notes = getValue(notesResult) as number;
    const indexed = getValue(indexedResult) as number;
    const connections = getValue(connectionsResult) as number;
    const gaps = getValue(gapsResult) as number;

    const cacheHits = cacheResult.length > 0 && cacheResult[0].values.length > 0
      ? (cacheResult[0].values[0][0] as number || 0)
      : 0;
    const cacheTotal = cacheResult.length > 0 && cacheResult[0].values.length > 0
      ? (cacheResult[0].values[0][1] as number || 0)
      : 0;

    const lastUpdatedStr = getValue(lastUpdatedResult, null) as string | null;

    return {
      totalNotes: notes,
      indexedNotes: indexed,
      totalConnections: connections,
      totalGaps: gaps,
      cacheHitRate: cacheTotal > 0 ? cacheHits / cacheTotal : 0,
      lastUpdated: lastUpdatedStr ? new Date(lastUpdatedStr) : null,
    };
  }

  // ============================================
  // Analysis Support Methods (for analyzer.ts)
  // ============================================

  async updateAnalysisTime(noteId: number): Promise<void> {
    const db = this.ensureDb();
    db.run(
      `UPDATE notes SET last_analyzed_at = datetime('now') WHERE id = ?`,
      [noteId]
    );
    await this.save();
  }

  async upsertConnection(connection: {
    sourceNoteId: number;
    targetNoteId: number;
    relationType: RelationType;
    confidence: number;
    reasoning: string;
  }): Promise<void> {
    const db = this.ensureDb();

    // Try update first
    db.run(
      `UPDATE connections SET confidence = ?, reasoning = ?
       WHERE source_note_id = ? AND target_note_id = ? AND relation_type = ?`,
      [connection.confidence, connection.reasoning, connection.sourceNoteId, connection.targetNoteId, connection.relationType]
    );

    // Check if any row was updated
    const changes = db.getRowsModified();

    if (changes === 0) {
      // Insert new
      db.run(
        `INSERT INTO connections (source_note_id, target_note_id, relation_type, confidence, reasoning)
         VALUES (?, ?, ?, ?, ?)`,
        [connection.sourceNoteId, connection.targetNoteId, connection.relationType, connection.confidence, connection.reasoning]
      );
    }

    await this.save();
  }

  async upsertKnowledgeGap(gap: {
    noteId: number;
    topic: string;
    description: string;
    priority: GapPriority;
    suggestedResources?: string[];
  }): Promise<void> {
    const db = this.ensureDb();

    db.run(
      `INSERT INTO knowledge_gaps (note_id, topic, description, priority, suggested_resources)
       VALUES (?, ?, ?, ?, ?)`,
      [
        gap.noteId,
        gap.topic,
        gap.description,
        gap.priority,
        gap.suggestedResources ? JSON.stringify(gap.suggestedResources) : null
      ]
    );

    await this.save();
  }

  async getAnalysisStats(): Promise<{
    totalConnections: number;
    totalGaps: number;
    analyzedNotes: number;
    pendingAnalysis: number;
  }> {
    const db = this.ensureDb();

    const connectionsResult = db.exec('SELECT COUNT(*) as count FROM connections');
    const gapsResult = db.exec('SELECT COUNT(*) as count FROM knowledge_gaps');
    const analyzedResult = db.exec('SELECT COUNT(*) as count FROM notes WHERE last_analyzed_at IS NOT NULL');
    const pendingResult = db.exec('SELECT COUNT(*) as count FROM notes WHERE last_analyzed_at IS NULL AND embedding_id IS NOT NULL');

    const getValue = (result: any[]) => {
      if (result.length === 0 || result[0].values.length === 0) return 0;
      return result[0].values[0][0] as number;
    };

    return {
      totalConnections: getValue(connectionsResult),
      totalGaps: getValue(gapsResult),
      analyzedNotes: getValue(analyzedResult),
      pendingAnalysis: getValue(pendingResult),
    };
  }

  async clearCache(): Promise<void> {
    const db = this.ensureDb();
    db.run('DELETE FROM response_cache');
    db.run('DELETE FROM embedding_cache');
    await this.save();
  }

  // ============================================
  // Utility Methods
  // ============================================

  private hashContent(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }
}

// Re-export with original name for backward compatibility
export { OSBADatabase as Database };
