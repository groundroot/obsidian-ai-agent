/**
 * Embedding Service
 * OpenAI 임베딩 생성, 저장, 유사도 검색
 */

import { TFile, Vault, MetadataCache, parseYaml, stringifyYaml } from 'obsidian';
import { Database } from '../db/database';
import { AIProviderManager } from '../api/provider';
import {
  OSBASettings,
  SearchResult,
  RAGContext,
  BudgetExceededError,
  NoteIndexStatus,
  EmbeddingResult,
} from '../types';
import * as crypto from 'crypto';

// ============================================
// Constants
// ============================================

const CHUNK_SIZE = 6000; // characters per chunk (안전한 토큰 범위)
const CHUNK_OVERLAP = 500; // 청크 간 오버랩
const MAX_CONTEXT_TOKENS = 8000; // RAG 컨텍스트 최대 토큰
const BATCH_DELAY = 100; // ms between batch operations

// ============================================
// Embedding Service
// ============================================

export class EmbeddingService {
  private vault: Vault;
  private metadataCache: MetadataCache;
  private database: Database;
  private providerManager: AIProviderManager;
  private settings: OSBASettings;
  private processingQueue: Set<string> = new Set();

  constructor(
    vault: Vault,
    metadataCache: MetadataCache,
    database: Database,
    providerManager: AIProviderManager,
    settings: OSBASettings
  ) {
    this.vault = vault;
    this.metadataCache = metadataCache;
    this.database = database;
    this.providerManager = providerManager;
    this.settings = settings;
  }

  updateSettings(settings: OSBASettings): void {
    this.settings = settings;
  }

  // ============================================
  // Note Processing
  // ============================================

  /**
   * 노트 임베딩 생성 및 저장
   */
  async processNote(file: TFile): Promise<{
    success: boolean;
    cached: boolean;
    cost: number;
    noteId?: number;
    model?: string;
    contentHash?: string;
  }> {
    const path = file.path;

    // 이미 처리 중인지 확인
    if (this.processingQueue.has(path)) {
      return { success: true, cached: true, cost: 0 };
    }

    // 제외 폴더 체크
    if (this.isExcluded(path)) {
      return { success: false, cached: false, cost: 0 };
    }

    this.processingQueue.add(path);

    try {
      // 노트 내용 읽기
      const rawContent = await this.vault.cachedRead(file);
      const content = this.normalizeIndexableContent(rawContent);

      // 너무 작은 파일 무시
      if (content.length < 100) {
        return { success: false, cached: false, cost: 0 };
      }

      // 크기 제한 체크
      if (content.length > this.settings.maxNoteSize) {
        console.log(`Skipping large file: ${path} (${content.length} bytes)`);
        return { success: false, cached: false, cost: 0 };
      }

      // 콘텐츠 해시 계산
      const contentHash = this.computeHash(content);
      const existingNote = await this.database.getNoteByPath(path);

      if (existingNote?.embeddingId && existingNote.contentHash === contentHash) {
        return {
          success: true,
          cached: true,
          cost: 0,
          noteId: existingNote.id,
          model: this.settings.useOllama
            ? this.settings.ollamaEmbeddingModel
            : this.settings.embeddingModel,
          contentHash,
        };
      }

      // 캐시 확인
      const cachedEmbedding = await this.database.getCachedEmbedding(contentHash);
      if (cachedEmbedding) {
        // 캐시된 임베딩 사용
        const noteId = await this.database.upsertNote(
          path,
          file.basename,
          content
        );
        await this.database.storeEmbedding(noteId, cachedEmbedding);
        return {
          success: true,
          cached: true,
          cost: 0,
          noteId,
          model: this.settings.useOllama
            ? this.settings.ollamaEmbeddingModel
            : this.settings.embeddingModel,
          contentHash,
        };
      }

      // 예산 체크
      await this.checkBudget();

      // 임베딩 생성
      const embedding = await this.generateEmbedding(content);

      // 노트 메타데이터 저장
      const noteId = await this.database.upsertNote(
        path,
        file.basename,
        content
      );

      // 임베딩 저장
      await this.database.storeEmbedding(noteId, embedding.embedding);

      // 캐시에도 저장
      await this.database.cacheEmbedding(contentHash, embedding.embedding, embedding.model);

      // 사용량 로깅
      await this.database.logUsage({
        provider: embedding.cost === 0 ? 'ollama' : 'openai',
        model: embedding.model,
        operation: 'embedding',
        inputTokens: embedding.inputTokens,
        outputTokens: 0,
        cost: embedding.cost,
        notePath: path,
      });

      return {
        success: true,
        cached: false,
        cost: embedding.cost,
        noteId,
        model: embedding.model,
        contentHash,
      };

    } catch (error) {
      if (error instanceof BudgetExceededError) {
        throw error;
      }
      console.error(`Failed to process note ${path}:`, error);
      return { success: false, cached: false, cost: 0 };
    } finally {
      this.processingQueue.delete(path);
    }
  }

  /**
   * 배치 임베딩 처리
   */
  async processBatch(
    files: TFile[],
    onProgress?: (current: number, total: number, path: string) => void
  ): Promise<{ processed: number; cached: number; failed: number; totalCost: number }> {
    let processed = 0;
    let cached = 0;
    let failed = 0;
    let totalCost = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (onProgress) {
        onProgress(i + 1, files.length, file.path);
      }

      try {
        const result = await this.processNote(file);

        if (result.success) {
          if (result.cached) {
            cached++;
          } else {
            processed++;
          }
          totalCost += result.cost;
        } else {
          failed++;
        }

        // Rate limiting
        if (!result.cached) {
          await this.sleep(BATCH_DELAY);
        }

      } catch (error) {
        if (error instanceof BudgetExceededError) {
          console.warn('Budget exceeded, stopping batch processing');
          break;
        }
        failed++;
      }
    }

    return { processed, cached, failed, totalCost };
  }

  // ============================================
  // Similarity Search
  // ============================================

  /**
   * 유사한 노트 찾기
   */
  async findSimilarNotes(
    file: TFile,
    limit: number = 10
  ): Promise<SearchResult[]> {
    const rawContent = await this.vault.cachedRead(file);
    const content = this.normalizeIndexableContent(rawContent);
    const contentHash = this.computeHash(content);

    // 기존 임베딩 확인
    let embedding = await this.database.getCachedEmbedding(contentHash);

    if (!embedding) {
      // 새로 생성
      const result = await this.generateEmbedding(content);
      embedding = result.embedding;
    }

    // 유사도 검색
    const results = await this.database.findSimilar(embedding!, limit + 1);

    // 자기 자신 제외
    return results.filter(r => r.notePath !== file.path).slice(0, limit);
  }

  /**
   * 쿼리로 유사한 노트 찾기
   */
  async searchByQuery(query: string, limit: number = 10): Promise<SearchResult[]> {
    const result = await this.generateEmbedding(query);
    return this.database.findSimilar(result.embedding, limit);
  }

  async getIndexStatus(file: TFile): Promise<NoteIndexStatus> {
    if (this.isExcluded(file.path)) {
      return {
        status: 'excluded',
        contentHash: '',
      };
    }

    const rawContent = await this.vault.cachedRead(file);
    const content = this.normalizeIndexableContent(rawContent);
    const contentHash = this.computeHash(content);
    const note = await this.database.getNoteByPath(file.path);

    if (!note || !note.embeddingId) {
      return {
        status: 'not_indexed',
        contentHash,
        noteId: note?.id,
      };
    }

    if (note.contentHash !== contentHash) {
      return {
        status: 'stale',
        contentHash,
        noteId: note.id,
        embeddingId: note.embeddingId,
      };
    }

    return {
      status: 'indexed',
      contentHash,
      noteId: note.id,
      embeddingId: note.embeddingId,
    };
  }

  // ============================================
  // RAG Context Building
  // ============================================

  /**
   * RAG 컨텍스트 생성
   */
  async buildRAGContext(
    query: string,
    maxTokens: number = MAX_CONTEXT_TOKENS
  ): Promise<RAGContext> {
    // 쿼리 임베딩
    const queryEmbedding = await this.generateEmbedding(query);

    // 유사한 노트 검색
    const similarNotes = await this.database.findSimilar(
      queryEmbedding.embedding,
      20 // 충분히 많은 후보
    );

    const contextNotes: RAGContext['notes'] = [];
    let totalTokens = 0;
    let truncated = false;

    for (const note of similarNotes) {
      // 파일 존재 확인
      const file = this.vault.getAbstractFileByPath(note.notePath);
      if (!(file instanceof TFile)) continue;

      const content = await this.vault.cachedRead(file);
      const contentTokens = this.estimateTokens(content);

      // 토큰 제한 체크
      if (totalTokens + contentTokens > maxTokens) {
        // 부분 포함 가능한지 확인
        const remainingTokens = maxTokens - totalTokens;
        if (remainingTokens > 500) {
          // 부분 콘텐츠 추가
          const truncatedContent = this.truncateToTokens(content, remainingTokens);
          contextNotes.push({
            path: note.notePath,
            title: note.title,
            content: truncatedContent,
            similarity: note.similarity,
          });
          totalTokens += this.estimateTokens(truncatedContent);
        }
        truncated = true;
        break;
      }

      contextNotes.push({
        path: note.notePath,
        title: note.title,
        content,
        similarity: note.similarity,
      });
      totalTokens += contentTokens;
    }

    return {
      notes: contextNotes,
      totalTokens,
      truncated,
    };
  }

  /**
   * 특정 노트들로 RAG 컨텍스트 생성
   */
  async buildContextFromPaths(
    paths: string[],
    maxTokens: number = MAX_CONTEXT_TOKENS
  ): Promise<RAGContext> {
    const contextNotes: RAGContext['notes'] = [];
    let totalTokens = 0;
    let truncated = false;

    for (const path of paths) {
      const file = this.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;

      const content = await this.vault.cachedRead(file);
      const contentTokens = this.estimateTokens(content);

      if (totalTokens + contentTokens > maxTokens) {
        truncated = true;
        break;
      }

      contextNotes.push({
        path,
        title: file.basename,
        content,
        similarity: 1.0, // 직접 선택된 노트
      });
      totalTokens += contentTokens;
    }

    return {
      notes: contextNotes,
      totalTokens,
      truncated,
    };
  }

  // ============================================
  // Embedding Generation
  // ============================================

  private async generateEmbedding(text: string): Promise<EmbeddingResult> {
    // 텍스트가 너무 길면 청킹 후 평균화
    if (text.length > CHUNK_SIZE) {
      return this.generateChunkedEmbedding(text);
    }

    return this.providerManager.generateEmbedding(text);
  }

  /**
   * 긴 텍스트를 청킹하여 임베딩 생성 후 평균화
   */
  private async generateChunkedEmbedding(text: string): Promise<EmbeddingResult> {
    const chunks = this.chunkText(text);
    const embeddings: number[][] = [];
    let totalInputTokens = 0;
    let totalCost = 0;
    let model = '';

    for (const chunk of chunks) {
      const result = await this.providerManager.generateEmbedding(chunk);
      embeddings.push(result.embedding);
      totalInputTokens += result.inputTokens;
      totalCost += result.cost;
      model = result.model;

      // Rate limiting
      await this.sleep(50);
    }

    // 임베딩 평균화 (weighted by chunk length)
    const averagedEmbedding = this.averageEmbeddings(embeddings);

    return {
      embedding: averagedEmbedding,
      inputTokens: totalInputTokens,
      cost: totalCost,
      model,
      dimensions: averagedEmbedding.length,
    };
  }

  /**
   * 텍스트를 청크로 분할
   */
  private chunkText(text: string): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = start + CHUNK_SIZE;

      // 문장 경계에서 자르기 시도
      if (end < text.length) {
        const lastPeriod = text.lastIndexOf('.', end);
        const lastNewline = text.lastIndexOf('\n', end);
        const breakPoint = Math.max(lastPeriod, lastNewline);

        if (breakPoint > start + CHUNK_SIZE / 2) {
          end = breakPoint + 1;
        }
      }

      chunks.push(text.slice(start, end).trim());
      start = end - CHUNK_OVERLAP;
    }

    return chunks.filter(c => c.length > 0);
  }

  /**
   * 여러 임베딩의 평균 계산
   */
  private averageEmbeddings(embeddings: number[][]): number[] {
    if (embeddings.length === 0) return [];
    if (embeddings.length === 1) return embeddings[0];

    const dimensions = embeddings[0].length;
    const averaged = new Array(dimensions).fill(0);

    for (const embedding of embeddings) {
      for (let i = 0; i < dimensions; i++) {
        averaged[i] += embedding[i];
      }
    }

    // 정규화
    const magnitude = Math.sqrt(averaged.reduce((sum, val) => sum + val * val, 0));
    return averaged.map(val => val / magnitude);
  }

  // ============================================
  // Utility Methods
  // ============================================

  private computeHash(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  private normalizeIndexableContent(content: string): string {
    const withoutInsights = content
      .replace(/\n?## 🧠 Connected Insights[\s\S]*?(?=\n## |\n---|\s*$)/g, '\n')
      .trim();

    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?/;
    const match = withoutInsights.match(frontmatterRegex);

    if (!match) {
      return withoutInsights.trim();
    }

    try {
      const frontmatter = parseYaml(match[1]) || {};
      delete frontmatter.osba;

      const body = withoutInsights.slice(match[0].length).trim();
      if (Object.keys(frontmatter).length === 0) {
        return body;
      }

      return `---\n${stringifyYaml(frontmatter).trim()}\n---\n${body}`.trim();
    } catch (error) {
      return withoutInsights.trim();
    }
  }

  private isExcluded(path: string): boolean {
    // Get file for size check
    const file = this.vault.getAbstractFileByPath(path);

    // Check file size first (applies to both modes)
    if (file instanceof TFile && file.stat.size > this.settings.maxNoteSize) {
      return true;
    }

    // Check indexing mode
    if (this.settings.indexingMode === 'include') {
      // Include mode: only index files in includedFolders
      if (this.settings.includedFolders.length === 0) {
        // No folders specified, include nothing (exclude all)
        return true;
      }

      // Check if file is in any included folder
      const isIncluded = this.settings.includedFolders.some(folder =>
        path.startsWith(folder + '/') || path === folder
      );

      // If not in included folders, exclude it
      if (!isIncluded) {
        return true;
      }
    } else {
      // Exclude mode (default): exclude files in excludedFolders
      for (const folder of this.settings.excludedFolders) {
        if (path.startsWith(folder + '/') || path === folder) {
          return true;
        }
      }
    }

    // 태그 기반 제외는 메타데이터 캐시에서 확인
    if (file instanceof TFile) {
      const cache = this.metadataCache.getFileCache(file);
      if (cache?.frontmatter?.tags) {
        const tags = Array.isArray(cache.frontmatter.tags)
          ? cache.frontmatter.tags
          : [cache.frontmatter.tags];

        for (const tag of tags) {
          // Ensure tag is a string before calling replace
          const tagStr = typeof tag === 'string' ? tag : String(tag);
          if (this.settings.excludedTags.includes(tagStr.replace('#', ''))) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private estimateTokens(text: string): number {
    // 대략적 추정: 4 characters per token
    return Math.ceil(text.length / 4);
  }

  private truncateToTokens(text: string, maxTokens: number): string {
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) return text;

    // 문장 경계에서 자르기
    const truncated = text.slice(0, maxChars);
    const lastPeriod = truncated.lastIndexOf('.');
    if (lastPeriod > maxChars * 0.8) {
      return truncated.slice(0, lastPeriod + 1);
    }
    return truncated + '...';
  }

  private async checkBudget(): Promise<void> {
    const dailySummary = await this.database.getUsageSummary('day');

    if (dailySummary.totalCost >= this.settings.dailyBudgetLimit) {
      throw new BudgetExceededError(
        dailySummary.totalCost,
        this.settings.dailyBudgetLimit,
        'daily'
      );
    }

    const monthlySummary = await this.database.getUsageSummary('month');
    if (monthlySummary.totalCost >= this.settings.monthlyBudgetLimit) {
      throw new BudgetExceededError(
        monthlySummary.totalCost,
        this.settings.monthlyBudgetLimit,
        'monthly'
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================
  // Statistics
  // ============================================

  async getIndexingStats(): Promise<{
    totalNotes: number;
    indexedNotes: number;
    pendingNotes: number;
    lastUpdated: Date | null;
  }> {
    const allFiles = this.vault.getMarkdownFiles();
    const eligibleFiles = allFiles.filter(f => !this.isExcluded(f.path));

    const stats = await this.database.getStats();

    return {
      totalNotes: eligibleFiles.length,
      indexedNotes: stats.indexedNotes,
      pendingNotes: eligibleFiles.length - stats.indexedNotes,
      lastUpdated: stats.lastUpdated,
    };
  }
}
