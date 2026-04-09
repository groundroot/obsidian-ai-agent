/**
 * Sidebar Views
 * JobQueueView, CostDashboardView 등 사이드바 뷰 컴포넌트
 */

import {
  ItemView,
  WorkspaceLeaf,
  setIcon,
  ButtonComponent,
} from 'obsidian';
import type OSBAPlugin from '../main';
import { JobStatusInfo, UsageLog, UsageSummary } from '../types';

// ============================================
// View Type Constants
// ============================================

export const JOB_QUEUE_VIEW_TYPE = 'osba-job-queue';
export const COST_DASHBOARD_VIEW_TYPE = 'osba-cost-dashboard';
export const LEGACY_JOB_QUEUE_VIEW_TYPE = 'osba-job-queue-view';
export const LEGACY_COST_DASHBOARD_VIEW_TYPE = 'osba-cost-dashboard-view';

// ============================================
// Job Queue View
// ============================================

export class JobQueueView extends ItemView {
  private plugin: OSBAPlugin;
  private contentContainer!: HTMLElement;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: OSBAPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return JOB_QUEUE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return '🔄 작업 큐';
  }

  getIcon(): string {
    return 'list-checks';
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('osba-view', 'osba-job-queue-view');

    // 헤더
    const header = container.createDiv({ cls: 'osba-view-header' });
    header.createEl('h4', { text: '🔄 작업 큐' });

    // 새로고침 버튼
    const refreshBtn = new ButtonComponent(header)
      .setIcon('refresh-cw')
      .setTooltip('새로고침')
      .onClick(() => this.refresh());
    refreshBtn.buttonEl.addClass('osba-icon-btn');

    // 콘텐츠 영역
    this.contentContainer = container.createDiv({ cls: 'osba-view-content' });

    // 초기 렌더링
    await this.refresh();

    // 자동 새로고침 (5초마다)
    this.refreshInterval = setInterval(() => {
      this.refresh();
    }, 5000);
  }

  async onClose() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  async refresh() {
    if (!this.contentContainer) return;

    this.contentContainer.empty();

    try {
      // 현재 처리 중인 작업 가져오기 (실제로는 plugin에서 관리)
      const jobs = await this.getActiveJobs();

      if (jobs.length === 0) {
        this.renderEmptyState();
        return;
      }

      // 작업 목록 렌더링
      const jobList = this.contentContainer.createDiv({ cls: 'osba-job-list' });

      for (const job of jobs) {
        this.renderJobItem(jobList, job);
      }

    } catch (error) {
      this.contentContainer.createEl('p', {
        text: `오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
        cls: 'osba-error',
      });
    }
  }

  private renderEmptyState() {
    const emptyState = this.contentContainer.createDiv({ cls: 'osba-empty-state' });
    emptyState.createEl('p', { text: '현재 진행 중인 작업이 없습니다.' });

    // 인덱싱 시작 버튼
    const actionContainer = emptyState.createDiv({ cls: 'osba-action-container' });
    new ButtonComponent(actionContainer)
      .setButtonText('전체 인덱싱 시작')
      .setCta()
      .onClick(async () => {
        // 인덱싱 시작 로직
        if (this.plugin.embeddingService) {
          const files = this.app.vault.getMarkdownFiles();
          // 실제 구현에서는 BatchProgressModal을 사용
          this.refresh();
        }
      });
  }

  private renderJobItem(container: HTMLElement, job: JobStatusInfo) {
    const item = container.createDiv({ cls: 'osba-job-item' });

    // 상태 아이콘
    const statusIcon = item.createDiv({ cls: 'osba-job-status' });
    switch (job.status) {
      case 'pending':
        setIcon(statusIcon, 'clock');
        statusIcon.addClass('osba-status-pending');
        break;
      case 'running':
        setIcon(statusIcon, 'loader');
        statusIcon.addClass('osba-status-running');
        break;
      case 'completed':
        setIcon(statusIcon, 'check-circle');
        statusIcon.addClass('osba-status-completed');
        break;
      case 'failed':
        setIcon(statusIcon, 'x-circle');
        statusIcon.addClass('osba-status-failed');
        break;
    }

    // 작업 정보
    const info = item.createDiv({ cls: 'osba-job-info' });
    info.createEl('strong', { text: this.getJobTypeLabel(job.type) });

    if (job.notePath) {
      info.createEl('small', { text: job.notePath });
    }

    // 진행률 (처리 중인 경우)
    if (job.status === 'running' && job.progress !== undefined) {
      const progressContainer = info.createDiv({ cls: 'osba-progress-mini' });
      const progressBar = progressContainer.createDiv({ cls: 'osba-progress-bar-mini' });
      progressBar.style.width = `${job.progress * 100}%`;
    }

    // 에러 메시지 (실패한 경우)
    if (job.status === 'failed' && job.error) {
      item.createEl('small', {
        text: job.error,
        cls: 'osba-error-text',
      });
    }
  }

  private getJobTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      embedding: '📊 임베딩 생성',
      analysis: '🔍 연결 분석',
      batch_embedding: '📦 배치 임베딩',
      batch_analysis: '📦 배치 분석',
    };
    return labels[type] || type;
  }

  private async getActiveJobs(): Promise<JobStatusInfo[]> {
    // 실제 구현에서는 plugin에서 작업 큐를 관리
    // 여기서는 더미 데이터 반환
    return [];
  }
}

// ============================================
// Cost Dashboard View
// ============================================

export class CostDashboardView extends ItemView {
  private plugin: OSBAPlugin;
  private contentContainer!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: OSBAPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return COST_DASHBOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return '💰 비용 대시보드';
  }

  getIcon(): string {
    return 'coins';
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('osba-view', 'osba-cost-dashboard-view');

    // 헤더
    const header = container.createDiv({ cls: 'osba-view-header' });
    header.createEl('h4', { text: '💰 비용 대시보드' });

    // 새로고침 버튼
    const refreshBtn = new ButtonComponent(header)
      .setIcon('refresh-cw')
      .setTooltip('새로고침')
      .onClick(() => this.refresh());
    refreshBtn.buttonEl.addClass('osba-icon-btn');

    // 콘텐츠 영역
    this.contentContainer = container.createDiv({ cls: 'osba-view-content' });

    // 초기 렌더링
    await this.refresh();
  }

  async onClose() {
    // 정리 작업
  }

  async refresh() {
    if (!this.contentContainer) return;
    if (!this.plugin.database) return;

    this.contentContainer.empty();

    try {
      // 사용량 통계 가져오기
      const dailySummary = await this.plugin.database.getUsageSummary('day');
      const monthlySummary = await this.plugin.database.getUsageSummary('month');
      const allTimeSummary = await this.plugin.database.getUsageSummary('all');

      // 예산 정보
      const settings = this.plugin.settings;

      // 오늘 비용 섹션
      this.renderCostSection(
        '📅 오늘',
        dailySummary.totalCost,
        settings.dailyBudgetLimit,
        dailySummary.totalRequests
      );

      // 이번 달 비용 섹션
      this.renderCostSection(
        '📆 이번 달',
        monthlySummary.totalCost,
        settings.monthlyBudgetLimit,
        monthlySummary.totalRequests
      );

      // 전체 비용 섹션
      this.renderAllTimeStats(allTimeSummary);

      // 제공자별 통계
      await this.renderProviderStats();

      // 최근 사용 내역
      await this.renderRecentUsage();

    } catch (error) {
      this.contentContainer.createEl('p', {
        text: `오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
        cls: 'osba-error',
      });
    }
  }

  private renderCostSection(
    title: string,
    cost: number,
    budget: number,
    requests: number
  ) {
    const section = this.contentContainer.createDiv({ cls: 'osba-cost-section' });

    // 제목
    section.createEl('h5', { text: title });

    // 비용 표시
    const costDisplay = section.createDiv({ cls: 'osba-cost-display' });
    const costValue = costDisplay.createEl('span', {
      text: `$${cost.toFixed(4)}`,
      cls: 'osba-cost-value',
    });

    // 예산 대비 비율 계산
    const ratio = cost / budget;
    if (ratio >= 1) {
      costValue.addClass('osba-over-budget');
    } else if (ratio >= 0.8) {
      costValue.addClass('osba-near-budget');
    }

    costDisplay.createEl('span', {
      text: ` / $${budget.toFixed(2)}`,
      cls: 'osba-budget-limit',
    });

    // 프로그레스 바
    const progressContainer = section.createDiv({ cls: 'osba-budget-progress' });
    const progressBar = progressContainer.createDiv({ cls: 'osba-budget-bar' });
    progressBar.style.width = `${Math.min(ratio * 100, 100)}%`;

    if (ratio >= 1) {
      progressBar.addClass('osba-over');
    } else if (ratio >= 0.8) {
      progressBar.addClass('osba-warning');
    }

    // 요청 수
    section.createEl('small', {
      text: `요청 수: ${requests}`,
      cls: 'osba-request-count',
    });
  }

  private renderAllTimeStats(summary: { totalCost: number; totalRequests: number; totalTokens: number }) {
    const section = this.contentContainer.createDiv({ cls: 'osba-stats-section' });
    section.createEl('h5', { text: '📊 전체 통계' });

    const grid = section.createDiv({ cls: 'osba-stats-grid' });

    // 총 비용
    const costStat = grid.createDiv({ cls: 'osba-stat-item' });
    costStat.createEl('span', { text: '총 비용', cls: 'osba-stat-label' });
    costStat.createEl('span', {
      text: `$${summary.totalCost.toFixed(4)}`,
      cls: 'osba-stat-value',
    });

    // 총 요청
    const requestStat = grid.createDiv({ cls: 'osba-stat-item' });
    requestStat.createEl('span', { text: '총 요청', cls: 'osba-stat-label' });
    requestStat.createEl('span', {
      text: summary.totalRequests.toLocaleString(),
      cls: 'osba-stat-value',
    });

    // 총 토큰
    const tokenStat = grid.createDiv({ cls: 'osba-stat-item' });
    tokenStat.createEl('span', { text: '총 토큰', cls: 'osba-stat-label' });
    tokenStat.createEl('span', {
      text: summary.totalTokens.toLocaleString(),
      cls: 'osba-stat-value',
    });
  }

  private async renderProviderStats() {
    const section = this.contentContainer.createDiv({ cls: 'osba-provider-section' });
    section.createEl('h5', { text: '🏢 제공자별 통계' });

    const providers = ['gemini', 'claude', 'openai', 'xai', 'ollama'] as const;
    const grid = section.createDiv({ cls: 'osba-provider-grid' });

    for (const provider of providers) {
      const providerStat = grid.createDiv({ cls: 'osba-provider-item' });

      // 제공자 아이콘/이름
      const nameEl = providerStat.createEl('div', { cls: 'osba-provider-name' });
      nameEl.createEl('span', { text: this.getProviderIcon(provider) });
      nameEl.createEl('span', { text: provider.charAt(0).toUpperCase() + provider.slice(1) });

      // 통계 (실제로는 DB에서 가져옴)
      const stats = await this.getProviderUsage(provider);
      providerStat.createEl('small', {
        text: `$${stats.cost.toFixed(4)} | ${stats.requests} 요청`,
      });
    }
  }

  private async renderRecentUsage() {
    const section = this.contentContainer.createDiv({ cls: 'osba-recent-section' });
    section.createEl('h5', { text: '📋 최근 사용 내역' });

    // 최근 사용 내역 가져오기
    const recentLogs = await this.getRecentUsageLogs(10);

    if (recentLogs.length === 0) {
      section.createEl('p', {
        text: '아직 사용 내역이 없습니다.',
        cls: 'osba-empty-message',
      });
      return;
    }

    const list = section.createEl('div', { cls: 'osba-usage-list' });

    for (const log of recentLogs) {
      const item = list.createDiv({ cls: 'osba-usage-item' });

      // 시간
      const time = item.createEl('span', { cls: 'osba-usage-time' });
      time.setText(this.formatTime(log.timestamp));

      // 정보
      const info = item.createDiv({ cls: 'osba-usage-info' });
      info.createEl('span', {
        text: `${this.getProviderIcon(log.provider)} ${log.model}`,
        cls: 'osba-usage-model',
      });
      info.createEl('span', {
        text: `${log.operation}`,
        cls: 'osba-usage-operation',
      });

      // 비용
      item.createEl('span', {
        text: `$${log.cost.toFixed(4)}`,
        cls: 'osba-usage-cost',
      });
    }
  }

  private getProviderIcon(provider: string): string {
    const icons: Record<string, string> = {
      gemini: '✨',
      claude: '🤖',
      openai: '🧠',
      xai: '🚀',
      ollama: '🦙',
    };
    return icons[provider] || '📦';
  }

  private async getProviderUsage(provider: string): Promise<{ cost: number; requests: number }> {
    // 실제로는 DB에서 쿼리
    // 여기서는 더미 데이터 반환
    return { cost: 0, requests: 0 };
  }

  private async getRecentUsageLogs(limit: number): Promise<UsageLog[]> {
    // 실제로는 DB에서 쿼리
    // 여기서는 빈 배열 반환
    return [];
  }

  private formatTime(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (minutes < 1) return '방금 전';
    if (minutes < 60) return `${minutes}분 전`;
    if (hours < 24) return `${hours}시간 전`;
    return date.toLocaleDateString('ko-KR');
  }
}

// ============================================
// Similar Notes Panel View
// ============================================

export const SIMILAR_NOTES_VIEW_TYPE = 'osba-similar-notes';

export class SimilarNotesView extends ItemView {
  private plugin: OSBAPlugin;
  private contentContainer!: HTMLElement;
  private currentFilePath: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: OSBAPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return SIMILAR_NOTES_VIEW_TYPE;
  }

  getDisplayText(): string {
    return '🔗 유사 노트';
  }

  getIcon(): string {
    return 'link';
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('osba-view', 'osba-similar-notes-view');

    // 헤더
    const header = container.createDiv({ cls: 'osba-view-header' });
    header.createEl('h4', { text: '🔗 유사한 노트' });

    // 새로고침 버튼
    const refreshBtn = new ButtonComponent(header)
      .setIcon('refresh-cw')
      .setTooltip('새로고침')
      .onClick(() => this.refresh());
    refreshBtn.buttonEl.addClass('osba-icon-btn');

    // 콘텐츠 영역
    this.contentContainer = container.createDiv({ cls: 'osba-view-content' });

    // 활성 파일 변경 이벤트 리스닝
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.path !== this.currentFilePath) {
          this.currentFilePath = activeFile.path;
          this.refresh();
        }
      })
    );

    // 초기 렌더링
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      this.currentFilePath = activeFile.path;
      await this.refresh();
    } else {
      this.renderEmptyState();
    }
  }

  async onClose() {
    // 정리 작업
  }

  async refresh() {
    if (!this.contentContainer) return;
    if (!this.plugin.embeddingService) return;

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      this.renderEmptyState();
      return;
    }

    this.contentContainer.empty();

    // 로딩 표시
    const loadingEl = this.contentContainer.createEl('p', {
      text: '유사한 노트 검색 중...',
      cls: 'osba-loading',
    });

    try {
      const results = await this.plugin.embeddingService.findSimilarNotes(activeFile, 10);

      loadingEl.remove();

      if (results.length === 0) {
        this.contentContainer.createEl('p', {
          text: '유사한 노트를 찾을 수 없습니다.',
          cls: 'osba-empty-message',
        });
        return;
      }

      // 현재 파일 표시
      const currentFileEl = this.contentContainer.createDiv({ cls: 'osba-current-file' });
      currentFileEl.createEl('small', { text: '현재 노트:' });
      currentFileEl.createEl('strong', { text: activeFile.basename });

      // 결과 목록
      const resultList = this.contentContainer.createDiv({ cls: 'osba-similar-list' });

      for (const result of results) {
        const item = resultList.createDiv({ cls: 'osba-similar-item' });

        // 유사도 표시
        const similarity = (result.similarity * 100).toFixed(1);
        const simBadge = item.createEl('span', {
          text: `${similarity}%`,
          cls: 'osba-sim-badge',
        });

        // 색상 설정
        if (result.similarity >= 0.8) {
          simBadge.addClass('osba-sim-high');
        } else if (result.similarity >= 0.5) {
          simBadge.addClass('osba-sim-medium');
        } else {
          simBadge.addClass('osba-sim-low');
        }

        // 노트 링크
        item.createEl('a', {
          text: result.title,
          href: result.notePath,
          cls: 'internal-link',
        });

        // 스니펫
        if (result.snippet) {
          item.createEl('small', {
            text: result.snippet.slice(0, 100) + '...',
            cls: 'osba-snippet',
          });
        }
      }

    } catch (error) {
      loadingEl.remove();
      this.contentContainer.createEl('p', {
        text: `오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
        cls: 'osba-error',
      });
    }
  }

  private renderEmptyState() {
    this.contentContainer.empty();
    this.contentContainer.createEl('p', {
      text: '노트를 열어서 유사한 노트를 확인하세요.',
      cls: 'osba-empty-message',
    });
  }
}

// ============================================
// Knowledge Graph Mini View
// ============================================

export const KNOWLEDGE_GRAPH_VIEW_TYPE = 'osba-knowledge-graph';

export class KnowledgeGraphView extends ItemView {
  private plugin: OSBAPlugin;
  private contentContainer!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: OSBAPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return KNOWLEDGE_GRAPH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return '🕸️ 지식 그래프';
  }

  getIcon(): string {
    return 'git-branch';
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('osba-view', 'osba-knowledge-graph-view');

    // 헤더
    const header = container.createDiv({ cls: 'osba-view-header' });
    header.createEl('h4', { text: '🕸️ 지식 그래프' });

    // 콘텐츠 영역
    this.contentContainer = container.createDiv({ cls: 'osba-view-content' });

    // 초기 렌더링
    await this.refresh();
  }

  async onClose() {
    // 정리 작업
  }

  async refresh() {
    if (!this.contentContainer) return;
    if (!this.plugin.database) return;

    this.contentContainer.empty();

    try {
      const stats = await this.plugin.database.getAnalysisStats();

      // 통계 표시
      const statsGrid = this.contentContainer.createDiv({ cls: 'osba-stats-grid' });

      // 분석된 노트 수
      const analyzedStat = statsGrid.createDiv({ cls: 'osba-stat-item' });
      analyzedStat.createEl('span', { text: '분석 완료', cls: 'osba-stat-label' });
      analyzedStat.createEl('span', {
        text: stats.analyzedNotes.toString(),
        cls: 'osba-stat-value',
      });

      // 발견된 연결 수
      const connStat = statsGrid.createDiv({ cls: 'osba-stat-item' });
      connStat.createEl('span', { text: '발견된 연결', cls: 'osba-stat-label' });
      connStat.createEl('span', {
        text: stats.totalConnections.toString(),
        cls: 'osba-stat-value',
      });

      // 지식 갭 수
      const gapStat = statsGrid.createDiv({ cls: 'osba-stat-item' });
      gapStat.createEl('span', { text: '지식 갭', cls: 'osba-stat-label' });
      gapStat.createEl('span', {
        text: stats.totalGaps.toString(),
        cls: 'osba-stat-value',
      });

      // 분석 대기 중
      const pendingStat = statsGrid.createDiv({ cls: 'osba-stat-item' });
      pendingStat.createEl('span', { text: '분석 대기', cls: 'osba-stat-label' });
      pendingStat.createEl('span', {
        text: stats.pendingAnalysis.toString(),
        cls: 'osba-stat-value',
      });

      // 연결 타입별 통계
      await this.renderConnectionTypes();

      // 지식 갭 우선순위
      await this.renderKnowledgeGaps();

    } catch (error) {
      this.contentContainer.createEl('p', {
        text: `오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
        cls: 'osba-error',
      });
    }
  }

  private async renderConnectionTypes() {
    const section = this.contentContainer.createDiv({ cls: 'osba-connection-types' });
    section.createEl('h5', { text: '📊 연결 유형' });

    // 연결 타입 아이콘과 이름
    const types = [
      { type: 'extends', icon: '📈', name: '확장' },
      { type: 'supports', icon: '✅', name: '지지' },
      { type: 'contradicts', icon: '⚡', name: '반박' },
      { type: 'examples', icon: '📋', name: '예시' },
      { type: 'related', icon: '🔗', name: '관련' },
    ];

    const typeGrid = section.createDiv({ cls: 'osba-type-grid' });

    for (const t of types) {
      const typeEl = typeGrid.createDiv({ cls: 'osba-type-item' });
      typeEl.createEl('span', { text: t.icon });
      typeEl.createEl('span', { text: t.name });
      // 실제로는 DB에서 타입별 카운트 가져오기
      typeEl.createEl('small', { text: '0' });
    }
  }

  private async renderKnowledgeGaps() {
    const section = this.contentContainer.createDiv({ cls: 'osba-gaps-section' });
    section.createEl('h5', { text: '🔍 지식 갭' });

    // 우선순위별 표시
    const priorities = [
      { priority: 'high', icon: '🔴', name: '높음' },
      { priority: 'medium', icon: '🟡', name: '중간' },
      { priority: 'low', icon: '🟢', name: '낮음' },
    ];

    const gapGrid = section.createDiv({ cls: 'osba-gap-grid' });

    for (const p of priorities) {
      const gapEl = gapGrid.createDiv({ cls: 'osba-gap-item' });
      gapEl.createEl('span', { text: p.icon });
      gapEl.createEl('span', { text: p.name });
      // 실제로는 DB에서 우선순위별 카운트 가져오기
      gapEl.createEl('small', { text: '0' });
    }

    // 전체 지식 갭 보기 버튼
    const actionContainer = section.createDiv({ cls: 'osba-action-container' });
    new ButtonComponent(actionContainer)
      .setButtonText('모든 지식 갭 보기')
      .onClick(() => {
        // 지식 갭 목록 모달 열기
      });
  }
}
