import { App, Plugin, PluginManifest, Notice, TFile, Events } from 'obsidian';
import { OSBASettings, DEFAULT_SETTINGS, Job, JobStatus, AnalysisResult } from './types';
import { OSBASettingTab } from './ui/settings';
import { Database } from './db/database';
import { AIProviderManager } from './api/provider';
import { EmbeddingService } from './core/embeddings';
import { ConnectionAnalyzer } from './core/analyzer';
import { FrontmatterManager } from './core/frontmatter';
import { QuickDraftModal, OSBAMainMenuModal } from './ui/modals';
import { ProgressModal } from './ui/progress-modal';
import {
  JobQueueView,
  JOB_QUEUE_VIEW_TYPE,
  LEGACY_JOB_QUEUE_VIEW_TYPE,
  CostDashboardView,
  COST_DASHBOARD_VIEW_TYPE,
  LEGACY_COST_DASHBOARD_VIEW_TYPE,
  SimilarNotesView,
  SIMILAR_NOTES_VIEW_TYPE,
  KnowledgeGraphView,
  KNOWLEDGE_GRAPH_VIEW_TYPE
} from './ui/views';

/**
 * Obsidian Second Brain Agent Plugin
 *
 * Main plugin class that orchestrates all OSBA functionality:
 * - AI-powered note drafting
 * - Automatic embedding generation
 * - Connection analysis
 * - Knowledge gap detection
 */
export default class OSBAPlugin extends Plugin {
  settings!: OSBASettings;
  database!: Database;
  providerManager!: AIProviderManager;
  embeddingService!: EmbeddingService;
  connectionAnalyzer!: ConnectionAnalyzer;
  frontmatterManager!: FrontmatterManager;

  // Event emitter for internal communication
  events: Events = new Events();

  // Job queue state
  private jobQueue: Map<string, Job> = new Map();
  private isProcessingQueue: boolean = false;

  // Prevent auto-analysis on Obsidian startup
  private pluginReady: boolean = false;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
  }

  async onload(): Promise<void> {
    console.log('Loading OSBA Plugin...');

    // Load settings
    await this.loadSettings();

    // Initialize core services
    await this.initializeServices();

    // Register views
    this.registerViews();

    // Register commands
    this.registerCommands();

    // Register event handlers
    this.registerEventHandlers();

    // Add settings tab
    this.addSettingTab(new OSBASettingTab(this.app, this));

    // Add ribbon icon
    this.addRibbonIcon('brain-circuit', 'OSBA: Quick Actions', () => {
      new OSBAMainMenuModal(this.app, this).open();
    });

    // Delay plugin ready flag to prevent auto-analysis on startup
    // The 'create' event fires for existing notes during Obsidian startup
    setTimeout(() => {
      this.pluginReady = true;
    }, 5000);

    console.log('OSBA Plugin loaded successfully');
    new Notice('Second Brain Agent loaded');
  }

  async onunload(): Promise<void> {
    console.log('Unloading OSBA Plugin...');

    // Cancel any running jobs
    for (const [id, job] of this.jobQueue) {
      if (job.status === 'running' || job.status === 'pending') {
        await this.cancelJob(id);
      }
    }

    // Close database connection
    if (this.database) {
      await this.database.close();
    }

    console.log('OSBA Plugin unloaded');
  }

  // ============================================
  // Initialization
  // ============================================

  private async initializeServices(): Promise<void> {
    try {
      // Initialize database with Obsidian file adapter
      const pluginDataDir = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
      const dbPath = `${pluginDataDir}/osba.db`;
      this.database = new Database(dbPath);

      // Set up persistence callbacks for sql.js database
      const adapter = this.app.vault.adapter;

      this.database.setSaveCallback(async (data: Uint8Array) => {
        try {
          // Ensure directory exists
          const dirPath = pluginDataDir;
          if (!(await adapter.exists(dirPath))) {
            await adapter.mkdir(dirPath);
          }
          // Convert Uint8Array to ArrayBuffer for Obsidian's adapter
          const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
          await adapter.writeBinary(dbPath, buffer);
        } catch (error) {
          console.error('Failed to save database:', error);
        }
      });

      this.database.setLoadCallback(async () => {
        try {
          if (await adapter.exists(dbPath)) {
            const data = await adapter.readBinary(dbPath);
            return new Uint8Array(data);
          }
        } catch (error) {
          console.log('No existing database found, will create new one');
        }
        return null;
      });

      await this.database.initialize();

      // Initialize AI provider manager
      this.providerManager = new AIProviderManager(this.settings);

      // Initialize embedding service
      this.embeddingService = new EmbeddingService(
        this.app.vault,
        this.app.metadataCache,
        this.database,
        this.providerManager,
        this.settings
      );

      // Initialize connection analyzer
      this.connectionAnalyzer = new ConnectionAnalyzer(
        this.app.vault,
        this.database,
        this.providerManager,
        this.embeddingService,
        this.settings
      );

      // Initialize frontmatter manager
      this.frontmatterManager = new FrontmatterManager(this.app);

    } catch (error) {
      console.error('Failed to initialize OSBA services:', error);
      new Notice('OSBA: Failed to initialize. Check console for details.');
      throw error;
    }
  }

  // ============================================
  // View Registration
  // ============================================

  private registerViews(): void {
    // Job Queue View
    this.registerView(
      JOB_QUEUE_VIEW_TYPE,
      (leaf) => new JobQueueView(leaf, this)
    );
    this.registerView(
      LEGACY_JOB_QUEUE_VIEW_TYPE,
      (leaf) => new JobQueueView(leaf, this)
    );

    // Cost Dashboard View
    this.registerView(
      COST_DASHBOARD_VIEW_TYPE,
      (leaf) => new CostDashboardView(leaf, this)
    );
    this.registerView(
      LEGACY_COST_DASHBOARD_VIEW_TYPE,
      (leaf) => new CostDashboardView(leaf, this)
    );

    // Similar Notes View
    this.registerView(
      SIMILAR_NOTES_VIEW_TYPE,
      (leaf) => new SimilarNotesView(leaf, this)
    );

    // Knowledge Graph View
    this.registerView(
      KNOWLEDGE_GRAPH_VIEW_TYPE,
      (leaf) => new KnowledgeGraphView(leaf, this)
    );
  }

  // ============================================
  // Command Registration
  // ============================================

  private registerCommands(): void {
    // Open OSBA Main Menu
    this.addCommand({
      id: 'open-main-menu',
      name: 'Open Main Menu - Quick Actions',
      callback: () => {
        new OSBAMainMenuModal(this.app, this).open();
      },
    });

    // Quick Draft command
    this.addCommand({
      id: 'quick-draft',
      name: 'Quick Draft - Create AI-powered note',
      callback: () => {
        new QuickDraftModal(this.app, this).open();
      },
    });

    // Analyze current note
    this.addCommand({
      id: 'analyze-note',
      name: 'Analyze Connections - Find related notes',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === 'md') {
          if (!checking) {
            this.analyzeNote(activeFile);
          }
          return true;
        }
        return false;
      },
    });

    // Generate embedding for current note
    this.addCommand({
      id: 'generate-embedding',
      name: 'Generate Embedding - Index current note',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === 'md') {
          if (!checking) {
            this.generateEmbedding(activeFile, {
              analyzeAfterIndex: this.settings.autoAnalyzeAfterIndex,
            });
          }
          return true;
        }
        return false;
      },
    });

    // Batch index all notes
    this.addCommand({
      id: 'batch-index',
      name: 'Batch Index - Index all notes in vault',
      callback: () => {
        this.batchIndexVault();
      },
    });

    this.addCommand({
      id: 'batch-analyze',
      name: 'Batch Analyze - Analyze all notes in vault',
      callback: () => {
        this.batchAnalyzeVault();
      },
    });

    // Open Job Queue
    this.addCommand({
      id: 'open-job-queue',
      name: 'Open Job Queue',
      callback: () => {
        this.activateView(JOB_QUEUE_VIEW_TYPE);
      },
    });

    // Open Cost Dashboard
    this.addCommand({
      id: 'open-cost-dashboard',
      name: 'Open Cost Dashboard',
      callback: () => {
        this.activateView(COST_DASHBOARD_VIEW_TYPE);
      },
    });

    // Find similar notes
    this.addCommand({
      id: 'find-similar',
      name: 'Find Similar Notes',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === 'md') {
          if (!checking) {
            this.findSimilarNotes(activeFile);
          }
          return true;
        }
        return false;
      },
    });

  }

  // ============================================
  // Event Handlers
  // ============================================

  private registerEventHandlers(): void {
    // Handle file creation
    this.registerEvent(
      this.app.vault.on('create', async (file) => {
        // Ignore events during Obsidian startup to prevent auto-analysis of existing notes
        if (!this.pluginReady) {
          return;
        }

        if (file instanceof TFile && file.extension === 'md') {
          if (this.settings.autoEmbedOnModify) {
            await this.generateEmbedding(file);
          }
          if (this.settings.autoAnalyzeOnCreate) {
            // Delay analysis to allow content to be written
            // Pass false to suppress notifications for auto-triggered analysis
            setTimeout(() => this.analyzeNote(file, false), 2000);
          }
        }
      })
    );

    // Handle file modification
    this.registerEvent(
      this.app.vault.on('modify', async (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          await this.syncIndexStatus(file);
          if (this.settings.autoEmbedOnModify) {
            // Debounce embedding updates
            this.debounceEmbedding(file);
          }
        }
      })
    );

    // Handle file deletion
    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          await this.database.deleteNote(file.path);
        }
      })
    );

    // Handle file rename
    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (file instanceof TFile && file.extension === 'md') {
          await this.database.updateNotePath(oldPath, file.path);
        }
      })
    );
  }

  // Debounce map for embedding updates
  private embeddingDebounceMap: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private debounceEmbedding(file: TFile): void {
    const existing = this.embeddingDebounceMap.get(file.path);
    if (existing) {
      clearTimeout(existing);
    }

    const timeout = setTimeout(async () => {
      this.embeddingDebounceMap.delete(file.path);
      await this.generateEmbedding(file, { silent: true, reason: '자동 업데이트' });
    }, 5000); // 5 second debounce

    this.embeddingDebounceMap.set(file.path, timeout);
  }

  // ============================================
  // Core Operations
  // ============================================

  async generateQuickDraft(prompt: string, insertInCurrentNote: boolean): Promise<string> {
    const job = this.createJob('quick-draft', { prompt, insertInCurrentNote });

    try {
      this.updateJobStatus(job.id, 'running');

      // Get current note context if available
      const activeFile = this.app.workspace.getActiveFile();
      let context = '';

      if (activeFile && activeFile.extension === 'md') {
        context = await this.app.vault.read(activeFile);

        // Get related notes via RAG
        const relatedNotes = await this.embeddingService.searchByQuery(context, 5);
        for (const note of relatedNotes) {
          const file = this.app.vault.getAbstractFileByPath(note.notePath);
          if (file instanceof TFile) {
            const content = await this.app.vault.read(file);
            context += `\n\n---\nRelated Note: ${note.title}\n${content.slice(0, 2000)}`;
          }
        }
      }

      this.updateJobProgress(job.id, 30);

      // Generate draft using AI
      const result = await this.providerManager.generateText(
        this.settings.quickDraftModel,
        this.buildQuickDraftPrompt(prompt, context)
      );

      this.updateJobProgress(job.id, 80);

      // Log cost - determine provider from model result
      let provider: 'gemini' | 'claude' | 'openai' | 'xai' = 'gemini';
      if (result.model.includes('claude')) {
        provider = 'claude';
      } else if (result.model.includes('gpt')) {
        provider = 'openai';
      } else if (result.model.includes('grok')) {
        provider = 'xai';
      }

      await this.database.logUsage({
        provider,
        model: result.model,
        operation: 'draft',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cost: result.cost,
        jobId: job.id,
      });

      // Handle output
      if (insertInCurrentNote && activeFile) {
        const editor = this.app.workspace.activeEditor?.editor;
        if (editor) {
          editor.replaceSelection(result.text);
        }
      } else {
        // Create new note
        const fileName = `Draft - ${new Date().toISOString().slice(0, 10)}.md`;
        await this.app.vault.create(fileName, result.text);
        new Notice(`Created: ${fileName}`);
      }

      this.updateJobStatus(job.id, 'completed', result);
      return result.text;

    } catch (error) {
      this.updateJobStatus(job.id, 'failed', undefined, error as Error);
      throw error;
    }
  }

  private buildQuickDraftPrompt(userPrompt: string, context: string): string {
    return `You are an expert knowledge management assistant. Generate a well-structured markdown note based on the user's request.

${context ? `## Context from existing notes:\n${context}\n\n` : ''}

## User Request:
${userPrompt}

## Guidelines:
- Use proper markdown formatting
- Include relevant headers and sections
- Be comprehensive but concise
- Include potential connections to other topics
- Suggest areas for further exploration

## Output:
Generate the markdown content for the note:`;
  }

  async generateEmbedding(
    file: TFile,
    options: { silent?: boolean; force?: boolean; reason?: string; analyzeAfterIndex?: boolean } = {}
  ): Promise<void> {
    const job = this.createJob('embed', { path: file.path, reason: options.reason || '현재 노트 인덱싱' });
    try {
      this.updateJobStatus(job.id, 'running');

      // Check if excluded
      if (this.isExcluded(file)) {
        this.updateJobStatus(job.id, 'completed', { skipped: true, reason: 'excluded' });
        if (!options.silent) {
          new Notice('이 노트는 인덱싱 대상에서 제외되었습니다.');
        }
        return;
      }

      if (!options.force) {
        const status = await this.embeddingService.getIndexStatus(file);
        if (status.status === 'indexed') {
          this.updateJobStatus(job.id, 'completed', { skipped: true, reason: 'indexed' });
          if (!options.silent) {
            new Notice('이미 최신 상태로 인덱싱되어 있습니다.');
          }
          return;
        }
      }

      const result = await this.embeddingService.processNote(file);
      this.updateJobProgress(job.id, 100);

      if (result.success && result.noteId && result.contentHash && result.model) {
        await this.frontmatterManager.updateEmbeddingStatus(file, {
          embeddingId: String(result.noteId),
          embeddingHash: result.contentHash,
          embeddingModel: result.model,
          indexStatus: 'indexed',
        });
        this.updateJobStatus(job.id, 'completed', result);

        if (!options.silent) {
          const modeText = result.cached ? '캐시/기존 데이터로' : '새로';
          new Notice(`${options.reason || '노트'} 인덱싱 완료 (${modeText} 처리됨)`);
        }

        if (options.analyzeAfterIndex) {
          await this.runNoteAnalysis(file, {
            showFeedback: !options.silent,
            useModal: !options.silent,
            skipIfCurrent: true,
            reason: `${options.reason || '인덱싱'} 후 연결분석`,
          });
        }
      } else {
        this.updateJobStatus(job.id, 'failed', result, new Error('인덱싱에 실패했습니다.'));
      }

    } catch (error) {
      this.updateJobStatus(job.id, 'failed', undefined, error as Error);
      console.error(`Failed to generate embedding for ${file.path}:`, error);
      if (!options.silent) {
        new Notice('인덱싱에 실패했습니다.');
      }
    }
  }

  async analyzeNote(file: TFile, showFeedback: boolean = true): Promise<void> {
    await this.runNoteAnalysis(file, {
      showFeedback,
      useModal: showFeedback,
      skipIfCurrent: true,
      reason: '연결 분석',
    });
  }

  private async runNoteAnalysis(
    file: TFile,
    options: {
      showFeedback?: boolean;
      useModal?: boolean;
      skipIfCurrent?: boolean;
      reason?: string;
    } = {}
  ): Promise<boolean> {
    const showFeedback = options.showFeedback ?? true;
    const useModal = options.useModal ?? showFeedback;

    // Check exclusion BEFORE opening modal to prevent unnecessary UI
    if (this.isExcluded(file)) {
      if (showFeedback) {
        new Notice('이 노트는 분석에서 제외되었습니다.');
      }
      console.log(`Note excluded from analysis: ${file.path}`);
      return false;
    }

    const job = this.createJob('analyze', { path: file.path });
    const modal = useModal ? new ProgressModal(this.app, '노트 분석') : null;
    modal?.open();
    modal?.updateState({ message: '분석 준비 중...' });

    try {
      const currentHash = await this.embeddingService.getContentHash(file);

      if (options.skipIfCurrent && await this.frontmatterManager.isAnalysisCurrent(file, currentHash)) {
        this.updateJobStatus(job.id, 'completed', { skipped: true, reason: 'analysis-current' });
        if (showFeedback) {
          new Notice('이미 최신 상태로 연결분석되어 있습니다.');
        }
        modal?.close();
        return true;
      }

      const indexReady = await this.ensureNoteIndexedForAction(file, options.reason || '연결 분석', showFeedback);
      if (!indexReady) {
        modal?.close();
        return false;
      }

      this.updateJobStatus(job.id, 'running');

      modal?.updateProgress(30, '관련 노트 찾는 중...');

      // Actual analysis logic here logic is inside connectionAnalyzer.analyzeNote
      // But since analyzeNote is atomic in the current implementation, we can just await it
      // For better progress updates, we'd need to modify connectionAnalyzer to accept a progress callback
      // For now, we simulate progress steps 

      modal?.updateProgress(50, 'AI 분석 실행 중...');
      const result = await this.connectionAnalyzer.analyzeNote(file);

      modal?.updateProgress(80, '결과 저장 중...');

      // Update note frontmatter
      await this.updateNoteFrontmatter(file, result, currentHash);

      // Add Connected Insights section
      await this.addInsightsSection(file, result);

      this.updateJobStatus(job.id, 'completed', result);

      modal?.complete(`✅ ${result.connections.length}개의 연결 발견!`);
      if (modal) {
        setTimeout(() => modal.close(), 1500);
      }

      if (showFeedback) {
        new Notice(`Analysis complete: Found ${result.connections.length} connections`);
      }
      return true;

    } catch (error) {
      this.updateJobStatus(job.id, 'failed', undefined, error as Error);
      modal?.setError(error instanceof Error ? error.message : 'Analysis failed');
      if (showFeedback) {
        new Notice('Analysis failed. Check console for details.');
      }
      return false;
    }
  }

  async findSimilarNotes(file: TFile): Promise<void> {
    const job = this.createJob('find-similar', { path: file.path });
    try {
      this.updateJobStatus(job.id, 'running');
      const indexReady = await this.ensureNoteIndexedForAction(file, '유사 노트 찾기');
      if (!indexReady) {
        this.updateJobStatus(job.id, 'failed', undefined, new Error('현재 노트를 인덱싱할 수 없습니다.'));
        return;
      }

      const similar = await this.embeddingService.findSimilarNotes(file, 10);
      this.updateJobProgress(job.id, 80);

      // Save to frontmatter
      const similarForFrontmatter = similar.map(n => ({
        title: n.title,
        path: n.notePath,
        similarity: n.similarity
      }));
      await this.frontmatterManager.updateSimilarNotes(file, similarForFrontmatter);
      this.updateJobProgress(job.id, 100);
      this.updateJobStatus(job.id, 'completed', { count: similar.length, notePath: file.path });

      // Display results in a modal or notice
      if (similar.length === 0) {
        new Notice('No similar notes found. Try indexing your vault first.');
      } else {
        const resultText = similar
          .map((n, i) => `${i + 1}. ${n.title} (${(n.similarity * 100).toFixed(1)}%)`)
          .join('\n');
        new Notice(`Similar notes saved to frontmatter!\n\nTop matches:\n${resultText}`, 5000);
      }

    } catch (error) {
      this.updateJobStatus(job.id, 'failed', undefined, error as Error);
      console.error('Failed to find similar notes:', error);
      new Notice('Failed to find similar notes');
    }
  }

  async batchIndexVault(forceReindex: boolean = false): Promise<void> {
    const job = this.createJob('batch-embed', {});
    const modal = new ProgressModal(this.app, '전체 인덱싱');
    modal.open();
    modal.updateState({ message: '인덱싱 준비 중...', progress: 0 });

    try {
      this.updateJobStatus(job.id, 'running');

      const allFiles = this.app.vault.getMarkdownFiles()
        .filter(f => !this.isExcluded(f));
      const files: TFile[] = [];

      for (const file of allFiles) {
        if (forceReindex) {
          files.push(file);
          continue;
        }

        const status = await this.embeddingService.getIndexStatus(file);
        if (status.status === 'not_indexed' || status.status === 'stale') {
          files.push(file);
        }
      }

      let processed = 0;
      const total = files.length;

      if (total === 0) {
        modal.complete('모든 노트가 이미 최신 인덱스 상태입니다.');
        setTimeout(() => modal.close(), 1500);
        new Notice('새로 인덱싱할 노트가 없습니다.');
        this.updateJobStatus(job.id, 'completed', { processed: 0 });
        return;
      }

      modal.updateState({
        message: `총 ${total}개 노트 인덱싱 시작`,
        subMessage: '잠시만 기다려주세요...'
      });

      for (const file of files) {
        // Update progress modal
        modal.updateProgress(
          (processed / total) * 100,
          `${processed}/${total} 처리 중`
        );
        modal.updateState({ subMessage: file.basename });

        // Generate embedding
        await this.generateEmbedding(file, {
          silent: true,
          force: forceReindex,
          reason: '전체 인덱싱',
          analyzeAfterIndex: this.settings.autoAnalyzeAfterIndex,
        });

        processed++;
        this.updateJobProgress(job.id, Math.round((processed / total) * 100));
      }

      this.updateJobStatus(job.id, 'completed', { processed });
      modal.complete(`✅ ${processed}개 노트 인덱싱 완료!`);

      // Close modal after 2 seconds
      setTimeout(() => modal.close(), 2000);
      new Notice(`${processed}개 노트를 인덱싱했습니다.`);

    } catch (error) {
      this.updateJobStatus(job.id, 'failed', undefined, error as Error);
      modal.setError(error instanceof Error ? error.message : 'Batch indexing failed');
      new Notice('Batch indexing failed');
    }
  }

  async batchAnalyzeVault(forceReanalyze: boolean = false): Promise<void> {
    const job = this.createJob('batch-analyze', {});
    const modal = new ProgressModal(this.app, forceReanalyze ? '강제 전체 연결분석' : '전체 연결분석');
    modal.open();
    modal.updateState({ message: '분석 준비 중...', progress: 0 });

    try {
      this.updateJobStatus(job.id, 'running');

      const allFiles = this.app.vault.getMarkdownFiles()
        .filter(f => !this.isExcluded(f));
      const files: TFile[] = [];

      for (const file of allFiles) {
        if (forceReanalyze) {
          files.push(file);
          continue;
        }

        const currentHash = await this.embeddingService.getContentHash(file);
        const isCurrent = await this.frontmatterManager.isAnalysisCurrent(file, currentHash);
        if (!isCurrent) {
          files.push(file);
        }
      }

      let processed = 0;
      let skipped = 0;
      const total = files.length;

      if (total === 0) {
        modal.complete('모든 노트가 이미 최신 연결분석 상태입니다.');
        setTimeout(() => modal.close(), 1500);
        new Notice('새로 분석할 노트가 없습니다.');
        this.updateJobStatus(job.id, 'completed', { processed: 0, skipped: allFiles.length });
        return;
      }

      modal.updateState({
        message: `총 ${total}개 노트 ${forceReanalyze ? '강제 연결분석' : '연결분석'} 시작`,
        subMessage: '잠시만 기다려주세요...'
      });

      for (const file of files) {
        modal.updateProgress(
          (processed / total) * 100,
          `${processed}/${total} 분석 중`
        );
        modal.updateState({ subMessage: file.basename });

        const analyzed = await this.runNoteAnalysis(file, {
          showFeedback: false,
          useModal: false,
          skipIfCurrent: !forceReanalyze,
          reason: forceReanalyze ? '강제 전체 연결분석' : '전체 연결분석',
        });

        if (analyzed) {
          processed++;
        } else {
          skipped++;
        }

        this.updateJobProgress(job.id, Math.round(((processed + skipped) / total) * 100));
      }

      this.updateJobStatus(job.id, 'completed', { processed, skipped });
      modal.complete(`✅ ${processed}개 노트 ${forceReanalyze ? '강제 연결분석' : '연결분석'} 완료!`);
      setTimeout(() => modal.close(), 2000);
      new Notice(`${processed}개 노트를 ${forceReanalyze ? '강제 연결분석' : '연결분석'}했습니다.`);
    } catch (error) {
      this.updateJobStatus(job.id, 'failed', undefined, error as Error);
      modal.setError(error instanceof Error ? error.message : 'Batch analysis failed');
      new Notice('Batch analysis failed');
    }
  }

  // ============================================
  // Helper Methods
  // ============================================

  public isExcluded(file: TFile): boolean {
    // Check file size first (applies to both modes)
    if (file.stat.size > this.settings.maxNoteSize) {
      console.log(`[OSBA] Note excluded - File size (${(file.stat.size / 1024).toFixed(1)}KB) exceeds maxNoteSize (${(this.settings.maxNoteSize / 1024).toFixed(1)}KB): ${file.path}`);
      return true;
    }

    // Check indexing mode
    if (this.settings.indexingMode === 'include') {
      // Include mode: only index files in includedFolders
      if (this.settings.includedFolders.length === 0) {
        // No folders specified, include nothing (exclude all)
        console.log(`[OSBA] Note excluded - Include mode active but no folders specified: ${file.path}`);
        return true;
      }

      // Check if file is in any included folder
      const isIncluded = this.settings.includedFolders.some(folder =>
        file.path.startsWith(folder + '/') || file.path === folder
      );

      // If not in included folders, exclude it
      if (!isIncluded) {
        console.log(`[OSBA] Note excluded - Not in includedFolders [${this.settings.includedFolders.join(', ')}]: ${file.path}`);
        return true;
      }
    } else {
      // Exclude mode (default): exclude files in excludedFolders
      for (const folder of this.settings.excludedFolders) {
        if (file.path.startsWith(folder + '/')) {
          console.log(`[OSBA] Note excluded - In excludedFolders [${folder}]: ${file.path}`);
          return true;
        }
      }
    }

    return false;
  }

  private async updateNoteFrontmatter(file: TFile, result: AnalysisResult, analysisHash?: string): Promise<void> {
    await this.frontmatterManager.updateNoteFrontmatter(file, result, analysisHash);
  }

  private async addInsightsSection(file: TFile, result: AnalysisResult): Promise<void> {
    await this.frontmatterManager.addInsightsSection(file, result);
  }

  async ensureNoteIndexedForAction(file: TFile, actionName: string, notify: boolean = true): Promise<boolean> {
    const status = await this.embeddingService.getIndexStatus(file);

    if (status.status === 'excluded') {
      if (notify) {
        new Notice(`이 노트는 ${actionName} 대상에서 제외되었습니다.`);
      }
      return false;
    }

    if (status.status === 'not_indexed' || status.status === 'stale') {
      const message = status.status === 'stale'
        ? `${actionName} 전에 현재 노트를 최신 상태로 다시 인덱싱합니다.`
        : `${actionName} 전에 현재 노트를 먼저 인덱싱합니다.`;
      if (notify) {
        new Notice(message);
      }

      await this.generateEmbedding(file, {
        silent: !notify,
        reason: actionName,
      });

      const refreshedStatus = await this.embeddingService.getIndexStatus(file);
      return refreshedStatus.status === 'indexed';
    }

    return true;
  }

  private async syncIndexStatus(file: TFile): Promise<void> {
    if (this.isExcluded(file)) {
      return;
    }

    const status = await this.embeddingService.getIndexStatus(file);
    if (status.status === 'stale') {
      await this.frontmatterManager.markEmbeddingStale(file);
    }
  }

  // ============================================
  // Job Queue Management
  // ============================================

  private createJob(type: Job['type'], data: Record<string, unknown>): Job {
    const job: Job = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type,
      status: 'pending',
      progress: 0,
      data,
      createdAt: new Date(),
    };

    this.jobQueue.set(job.id, job);
    this.events.trigger('job:created', job);

    return job;
  }

  private updateJobStatus(
    id: string,
    status: JobStatus,
    result?: unknown,
    error?: Error
  ): void {
    const job = this.jobQueue.get(id);
    if (!job) return;

    job.status = status;
    if (status === 'running') {
      job.startedAt = new Date();
    }
    if (status === 'completed' || status === 'failed') {
      job.completedAt = new Date();
    }
    if (result) {
      job.result = result;
    }
    if (error) {
      job.error = error.message;
    }

    this.events.trigger(`job:${status}`, job);
  }

  private updateJobProgress(id: string, progress: number): void {
    const job = this.jobQueue.get(id);
    if (!job) return;

    job.progress = progress;
    this.events.trigger('job:progress', job, progress);
  }

  async cancelJob(id: string): Promise<void> {
    const job = this.jobQueue.get(id);
    if (!job) return;

    job.status = 'cancelled';
    job.completedAt = new Date();
    this.events.trigger('job:cancelled', job);
  }

  getJobs(): Job[] {
    return Array.from(this.jobQueue.values());
  }

  startTrackedJob(type: Job['type'], data: Record<string, unknown>): Job {
    const job = this.createJob(type, data);
    this.updateJobStatus(job.id, 'running');
    return job;
  }

  setTrackedJobProgress(id: string, progress: number): void {
    this.updateJobProgress(id, progress);
  }

  completeTrackedJob(id: string, result?: unknown): void {
    this.updateJobStatus(id, 'completed', result);
  }

  failTrackedJob(id: string, error: Error, result?: unknown): void {
    this.updateJobStatus(id, 'failed', result, error);
  }

  // ============================================
  // View Activation
  // ============================================

  async activateView(viewType: string): Promise<void> {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(viewType)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({ type: viewType, active: true });
        leaf = rightLeaf;
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  // ============================================
  // Settings Management
  // ============================================

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);

    if (this.providerManager) {
      this.providerManager.updateSettings(this.settings);
    }
    if (this.embeddingService) {
      this.embeddingService.updateSettings(this.settings);
    }
    if (this.connectionAnalyzer) {
      this.connectionAnalyzer.updateSettings(this.settings);
    }
  }
}
