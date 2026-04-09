/**
 * UI Modals
 * Quick Draft, Analysis Results, Similar Notes 등 모달 UI
 */

import {
  App,
  Modal,
  Notice,
  Setting,
  TextAreaComponent,
  TFile,
  MarkdownRenderer,
  ButtonComponent,
} from 'obsidian';
import type OSBAPlugin from '../main';
import { AnalysisResult, SearchResult } from '../types';
import { COST_DASHBOARD_VIEW_TYPE, JOB_QUEUE_VIEW_TYPE } from './views';

// ============================================
// Quick Draft, Main Menu, Analysis Results, Similar Notes 등 모달 UI
// ============================================
// OSBA Main Menu Modal
// ============================================

export class OSBAMainMenuModal extends Modal {
  private plugin: OSBAPlugin;

  constructor(app: App, plugin: OSBAPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('osba-modal');
    contentEl.addClass('osba-main-menu');

    contentEl.createEl('h2', { text: '🧠 Second Brain Agent' });
    contentEl.createEl('p', { text: '실행할 작업을 선택하세요', cls: 'osba-modal-desc' });

    const grid = contentEl.createDiv({ cls: 'osba-menu-grid' });

    // 1. Analyze (Primary Action)
    this.createMenuButton(grid, '🔍', '연결 분석', '현재 노트를 분석하여 인사이트 도출', 'cta', () => {
      this.close();
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile && activeFile.extension === 'md') {
        this.plugin.analyzeNote(activeFile);
      } else {
        new Notice('분석할 마크다운 문서를 열어주세요.');
      }
    });

    // 2. Quick Draft
    this.createMenuButton(grid, '✨', '빠른 초안', 'AI와 함께 새로운 노트 작성', 'primary', () => {
      this.close();
      new QuickDraftModal(this.app, this.plugin).open();
    });

    // 3. Find Similar
    this.createMenuButton(grid, '🔗', '유사 노트 찾기', '관련된 노트 검색', 'secondary', () => {
      this.close();
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile && activeFile.extension === 'md') {
        this.plugin.findSimilarNotes(activeFile);
      } else {
        new Notice('검색 기준이 될 노트를 열어주세요.');
      }
    });

    // 4. Index Current
    this.createMenuButton(grid, '💾', '현재 노트 인덱싱', '현재 노트만 즉시 재학습', 'secondary', () => {
      this.close();
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile && activeFile.extension === 'md') {
        void this.plugin.generateEmbedding(activeFile, {
          force: true,
          reason: '현재 노트',
          analyzeAfterIndex: this.plugin.settings.autoAnalyzeAfterIndex,
        });
      } else {
        new Notice('인덱싱할 노트를 열어주세요.');
      }
    });

    contentEl.createEl('hr', { cls: 'osba-divider' });
    contentEl.createEl('span', { text: '관리 및 통계', cls: 'osba-section-label' });

    const subGrid = contentEl.createDiv({ cls: 'osba-menu-grid-small' });

    // 5. Batch Index
    this.createMenuButton(subGrid, '📦', '전체 인덱싱', '', 'secondary', () => {
      this.close();
      this.plugin.batchIndexVault();
    });

    this.createMenuButton(subGrid, '🧠', '전체 연결분석', '', 'secondary', () => {
      this.close();
      this.plugin.batchAnalyzeVault();
    });

    // 6. Cost Dashboard
    this.createMenuButton(subGrid, '💰', '비용 대시보드', '', 'secondary', () => {
      this.close();
      this.plugin.activateView(COST_DASHBOARD_VIEW_TYPE);
    });

    // 7. Job Queue
    this.createMenuButton(subGrid, '⏳', '작업 대기열', '', 'secondary', () => {
      this.close();
      this.plugin.activateView(JOB_QUEUE_VIEW_TYPE);
    });
  }

  private createMenuButton(
    container: HTMLElement,
    icon: string,
    title: string,
    desc: string,
    style: 'cta' | 'primary' | 'secondary',
    onClick: () => void
  ) {
    const btn = container.createDiv({ cls: `osba-menu-btn osba-menu-btn-${style}` });

    // Icon
    const iconEl = btn.createDiv({ cls: 'osba-menu-icon' });
    iconEl.setText(icon);

    // Text Container
    const textContainer = btn.createDiv({ cls: 'osba-menu-text' });
    textContainer.createDiv({ cls: 'osba-menu-title', text: title });
    if (desc) {
      textContainer.createDiv({ cls: 'osba-menu-desc', text: desc });
    }

    btn.addEventListener('click', onClick);
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class QuickDraftModal extends Modal {
  private plugin: OSBAPlugin;
  private promptInput!: TextAreaComponent;
  private resultContainer!: HTMLElement;
  private isProcessing: boolean = false;

  constructor(app: App, plugin: OSBAPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('osba-modal');

    // 헤더
    contentEl.createEl('h2', { text: '✨ Quick Draft' });
    contentEl.createEl('p', {
      text: '관련 노트의 컨텍스트를 활용하여 새로운 콘텐츠를 작성합니다.',
      cls: 'osba-modal-desc',
    });

    // 프롬프트 입력
    new Setting(contentEl)
      .setName('작성 요청')
      .setDesc('어떤 내용을 작성할지 설명해주세요')
      .addTextArea(text => {
        this.promptInput = text;
        text.setPlaceholder('예: "AI 기반 노트 관리 시스템의 장단점을 정리해줘"');
        text.inputEl.rows = 4;
        text.inputEl.style.width = '100%';
      });

    // 버튼 영역
    const buttonContainer = contentEl.createDiv({ cls: 'osba-button-container' });

    new ButtonComponent(buttonContainer)
      .setButtonText('생성하기')
      .setCta()
      .onClick(async () => {
        await this.generateDraft();
      });

    new ButtonComponent(buttonContainer)
      .setButtonText('취소')
      .onClick(() => {
        this.close();
      });

    // 결과 컨테이너
    this.resultContainer = contentEl.createDiv({ cls: 'osba-result-container' });
  }

  private async generateDraft() {
    const prompt = this.promptInput.getValue().trim();

    if (!prompt) {
      new Notice('작성 요청을 입력해주세요.');
      return;
    }

    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    this.resultContainer.empty();
    this.resultContainer.createEl('p', { text: '생성 중...', cls: 'osba-loading' });
    let jobId: string | null = null;

    try {
      const job = this.plugin.startTrackedJob('quick-draft', { prompt });
      jobId = job.id;
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile && activeFile.extension === 'md') {
        const ready = await this.plugin.ensureNoteIndexedForAction(activeFile, '빠른 초안');
        if (!ready) {
          this.plugin.failTrackedJob(job.id, new Error('현재 노트를 인덱싱할 수 없습니다.'));
          this.resultContainer.empty();
          return;
        }
      }

      this.plugin.setTrackedJobProgress(job.id, 30);
      const result = await this.plugin.connectionAnalyzer.generateQuickDraft(prompt);
      this.plugin.setTrackedJobProgress(job.id, 100);
      this.plugin.completeTrackedJob(job.id, { cost: result.cost, relatedNotes: result.relatedNotes.length });

      this.resultContainer.empty();

      // 관련 노트 표시
      if (result.relatedNotes.length > 0) {
        const relatedSection = this.resultContainer.createDiv({ cls: 'osba-related-notes' });
        relatedSection.createEl('h4', { text: '📚 참조된 노트' });

        const noteList = relatedSection.createEl('ul');
        for (const notePath of result.relatedNotes.slice(0, 5)) {
          const li = noteList.createEl('li');
          li.createEl('a', {
            text: notePath,
            href: notePath,
            cls: 'internal-link',
          });
        }
      }

      // 결과 표시
      const resultSection = this.resultContainer.createDiv({ cls: 'osba-draft-result' });
      resultSection.createEl('h4', { text: '📝 생성된 초안' });

      const previewEl = resultSection.createDiv({ cls: 'osba-markdown-preview' });
      await MarkdownRenderer.renderMarkdown(
        result.content,
        previewEl,
        '',
        null as any
      );

      // 비용 표시
      const costEl = resultSection.createEl('p', { cls: 'osba-cost' });
      costEl.setText(`💰 비용: $${result.cost.toFixed(4)}`);

      // 액션 버튼
      const actionContainer = resultSection.createDiv({ cls: 'osba-action-buttons' });

      new ButtonComponent(actionContainer)
        .setButtonText('새 노트로 저장')
        .setCta()
        .onClick(async () => {
          await this.saveAsNewNote(result.content);
        });

      new ButtonComponent(actionContainer)
        .setButtonText('클립보드에 복사')
        .onClick(async () => {
          await navigator.clipboard.writeText(result.content);
          new Notice('클립보드에 복사되었습니다.');
        });

      new ButtonComponent(actionContainer)
        .setButtonText('현재 노트에 삽입')
        .onClick(async () => {
          await this.insertToActiveNote(result.content);
        });

    } catch (error) {
      // quick draft job failure is tracked here to keep modal flow and queue in sync
      const message = error instanceof Error ? error : new Error('알 수 없는 오류');
      this.resultContainer.empty();
      this.resultContainer.createEl('p', {
        text: `오류: ${message.message}`,
        cls: 'osba-error',
      });
      if (jobId) {
        this.plugin.failTrackedJob(jobId, message);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async saveAsNewNote(content: string) {
    try {
      // 제목 추출 또는 생성
      const firstLine = content.split('\n')[0];
      let title = firstLine.replace(/^#*\s*/, '').trim();

      // Sanitize title: remove illegal characters for filenames
      // Windows/Mac illegal chars: \ / : * ? " < > |
      title = title.replace(/[\\/:*?"<>|]/g, '');

      if (!title) {
        title = `Quick Draft ${new Date().toISOString().slice(0, 10)}`;
      }

      const fileName = `${title}.md`;
      const file = await this.app.vault.create(fileName, content);

      new Notice(`새 노트가 생성되었습니다: ${fileName}`);
      this.app.workspace.openLinkText(file.path, '', true);
      this.close();

    } catch (error) {
      new Notice(`노트 생성 실패: ${error}`);
    }
  }

  private async insertToActiveNote(content: string) {
    const activeView = this.app.workspace.getActiveViewOfType(
      (this.app as any).plugins.plugins['obsidian']?.MarkdownView
    );

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice('활성화된 노트가 없습니다.');
      return;
    }

    try {
      const currentContent = await this.app.vault.read(activeFile);
      const newContent = currentContent + '\n\n' + content;
      await this.app.vault.modify(activeFile, newContent);
      new Notice('내용이 삽입되었습니다.');
      this.close();

    } catch (error) {
      new Notice(`삽입 실패: ${error}`);
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// ============================================
// Analysis Result Modal
// ============================================

export class AnalysisResultModal extends Modal {
  private plugin: OSBAPlugin;
  private result: AnalysisResult;
  private file: TFile;

  constructor(app: App, plugin: OSBAPlugin, result: AnalysisResult, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.result = result;
    this.file = file;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('osba-modal');

    // 헤더
    contentEl.createEl('h2', { text: `📊 분석 결과: ${this.file.basename}` });

    // 비용 정보
    const costEl = contentEl.createEl('p', { cls: 'osba-cost' });
    costEl.setText(`💰 분석 비용: $${this.result.cost.toFixed(4)}`);

    // 연결 섹션
    if (this.result.connections.length > 0) {
      const connSection = contentEl.createDiv({ cls: 'osba-section' });
      connSection.createEl('h3', { text: '🔗 발견된 연결' });

      const connList = connSection.createEl('div', { cls: 'osba-connection-list' });

      for (const conn of this.result.connections) {
        const connItem = connList.createDiv({ cls: 'osba-connection-item' });

        // 관계 타입 아이콘
        const typeIcon = this.getRelationTypeIcon(conn.relationType);
        const header = connItem.createDiv({ cls: 'osba-connection-header' });

        header.createEl('span', { text: typeIcon, cls: 'osba-relation-icon' });
        header.createEl('a', {
          text: conn.targetPath,
          href: conn.targetPath,
          cls: 'internal-link',
        });
        header.createEl('span', {
          text: `(${(conn.confidence * 100).toFixed(0)}%)`,
          cls: 'osba-confidence',
        });

        connItem.createEl('p', {
          text: conn.reasoning,
          cls: 'osba-reasoning',
        });
      }
    } else {
      contentEl.createEl('p', { text: '발견된 연결이 없습니다.' });
    }

    // 지식 갭 섹션
    if (this.result.gaps.length > 0) {
      const gapSection = contentEl.createDiv({ cls: 'osba-section' });
      gapSection.createEl('h3', { text: '🔍 지식 갭' });

      const gapList = gapSection.createEl('div', { cls: 'osba-gap-list' });

      for (const gap of this.result.gaps) {
        const gapItem = gapList.createDiv({ cls: 'osba-gap-item' });

        const priorityIcon = this.getPriorityIcon(gap.priority);
        const header = gapItem.createDiv({ cls: 'osba-gap-header' });

        header.createEl('span', { text: priorityIcon });
        header.createEl('strong', { text: gap.topic });

        gapItem.createEl('p', { text: gap.description });

        if (gap.suggestedResources && gap.suggestedResources.length > 0) {
          const resourceList = gapItem.createEl('ul', { cls: 'osba-resources' });
          for (const resource of gap.suggestedResources) {
            resourceList.createEl('li', { text: resource });
          }
        }
      }
    }

    // 인사이트 섹션
    if (this.result.insights) {
      const insightSection = contentEl.createDiv({ cls: 'osba-section' });
      insightSection.createEl('h3', { text: '💡 인사이트' });
      insightSection.createEl('p', { text: this.result.insights });
    }

    // 닫기 버튼
    const buttonContainer = contentEl.createDiv({ cls: 'osba-button-container' });
    new ButtonComponent(buttonContainer)
      .setButtonText('닫기')
      .onClick(() => this.close());
  }

  private getRelationTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      extends: '📈',
      supports: '✅',
      contradicts: '⚡',
      examples: '📋',
      related: '🔗',
    };
    return icons[type] || '🔗';
  }

  private getPriorityIcon(priority: string): string {
    const icons: Record<string, string> = {
      high: '🔴',
      medium: '🟡',
      low: '🟢',
    };
    return icons[priority] || '🟡';
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// ============================================
// Similar Notes Modal
// ============================================

export class SimilarNotesModal extends Modal {
  private plugin: OSBAPlugin;
  private results: SearchResult[];
  private sourceFile: TFile;

  constructor(app: App, plugin: OSBAPlugin, results: SearchResult[], sourceFile: TFile) {
    super(app);
    this.plugin = plugin;
    this.results = results;
    this.sourceFile = sourceFile;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('osba-modal');

    // 헤더
    contentEl.createEl('h2', { text: `🔍 유사한 노트: ${this.sourceFile.basename}` });

    if (this.results.length === 0) {
      contentEl.createEl('p', { text: '유사한 노트를 찾을 수 없습니다.' });
      return;
    }

    // 결과 목록
    const resultList = contentEl.createDiv({ cls: 'osba-similar-list' });

    for (const result of this.results) {
      const item = resultList.createDiv({ cls: 'osba-similar-item' });

      // 유사도 바
      const similarity = result.similarity;
      const similarityPercent = (similarity * 100).toFixed(1);

      const header = item.createDiv({ cls: 'osba-similar-header' });

      header.createEl('a', {
        text: result.title,
        href: result.notePath,
        cls: 'internal-link',
      });

      header.createEl('span', {
        text: `${similarityPercent}%`,
        cls: 'osba-similarity-badge',
      });

      // 유사도 바 시각화
      const barContainer = item.createDiv({ cls: 'osba-similarity-bar-container' });
      const bar = barContainer.createDiv({ cls: 'osba-similarity-bar' });
      bar.style.width = `${similarityPercent}%`;

      // 스니펫
      if (result.snippet) {
        item.createEl('p', {
          text: result.snippet,
          cls: 'osba-snippet',
        });
      }
    }

    // 닫기 버튼
    const buttonContainer = contentEl.createDiv({ cls: 'osba-button-container' });
    new ButtonComponent(buttonContainer)
      .setButtonText('닫기')
      .onClick(() => this.close());
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// ============================================
// Batch Progress Modal
// ============================================

export class BatchProgressModal extends Modal {
  private plugin: OSBAPlugin;
  private progressBar!: HTMLElement;
  private statusText!: HTMLElement;
  private currentFile!: HTMLElement;
  private cancelButton!: ButtonComponent;
  private isCancelled: boolean = false;
  private onCancel: () => void;

  constructor(app: App, plugin: OSBAPlugin, onCancel: () => void) {
    super(app);
    this.plugin = plugin;
    this.onCancel = onCancel;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('osba-modal');

    // 헤더
    contentEl.createEl('h2', { text: '📦 배치 인덱싱' });

    // 상태 텍스트
    this.statusText = contentEl.createEl('p', { cls: 'osba-status' });
    this.statusText.setText('준비 중...');

    // 현재 파일
    this.currentFile = contentEl.createEl('p', { cls: 'osba-current-file' });

    // 프로그레스 바
    const progressContainer = contentEl.createDiv({ cls: 'osba-progress-container' });
    this.progressBar = progressContainer.createDiv({ cls: 'osba-progress-bar' });
    this.progressBar.style.width = '0%';

    // 취소 버튼
    const buttonContainer = contentEl.createDiv({ cls: 'osba-button-container' });
    this.cancelButton = new ButtonComponent(buttonContainer)
      .setButtonText('취소')
      .setWarning()
      .onClick(() => {
        this.isCancelled = true;
        this.onCancel();
        this.close();
      });
  }

  updateProgress(current: number, total: number, currentPath: string) {
    const percent = (current / total) * 100;
    this.progressBar.style.width = `${percent}%`;
    this.statusText.setText(`진행 중: ${current} / ${total}`);
    this.currentFile.setText(`현재: ${currentPath}`);
  }

  complete(stats: { processed: number; cached: number; failed: number; totalCost: number }) {
    this.statusText.setText('완료!');
    this.currentFile.setText(
      `처리: ${stats.processed} | 캐시: ${stats.cached} | 실패: ${stats.failed} | 비용: $${stats.totalCost.toFixed(4)}`
    );
    this.progressBar.style.width = '100%';
    this.cancelButton.setButtonText('닫기');
    this.cancelButton.removeCta();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
