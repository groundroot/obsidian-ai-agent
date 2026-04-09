/**
 * Connection Analyzer
 * LLM 기반 노트 간 연결 분석 및 지식 갭 발견
 */

import { TFile, Vault } from 'obsidian';
import { Database } from '../db/database';
import { AIProviderManager } from '../api/provider';
import { EmbeddingService } from './embeddings';
import {
  OSBASettings,
  AnalysisResult,
  RelationType,
  GapPriority,
  RAGContext,
  GenerateResult,
  BudgetExceededError,
} from '../types';

// ============================================
// Prompts
// ============================================

const ANALYSIS_SYSTEM_PROMPT = `당신은 지식 관리 전문가입니다. 노트 간의 의미적 연결을 분석하고 지식 갭을 발견합니다.

분석 시 다음을 고려하세요:
1. 개념적 연관성: 동일하거나 유사한 개념을 다루는지
2. 논리적 관계: 하나가 다른 것을 확장, 지지, 반박하는지
3. 사례 관계: 하나가 다른 것의 구체적 예시인지
4. 지식 갭: 언급되었지만 깊이 다루지 않은 주제

응답은 반드시 JSON 형식으로 제공하세요.`;

const ANALYSIS_PROMPT = `다음 노트를 분석하고 관련 노트들과의 연결 및 지식 갭을 찾아주세요.

## 분석할 노트
제목: {title}
내용:
{content}

## 관련 노트들
{relatedNotes}

## 응답 형식
다음 JSON 형식으로 응답하세요:
{
  "connections": [
    {
      "targetPath": "연결된 노트 경로",
      "relationType": "extends|supports|contradicts|examples|related",
      "confidence": 0.0-1.0,
      "reasoning": "연결 이유 설명"
    }
  ],
  "gaps": [
    {
      "topic": "탐구가 필요한 주제",
      "description": "왜 이 주제가 중요한지",
      "priority": "high|medium|low",
      "suggestedResources": ["추천 자료 1", "추천 자료 2"]
    }
  ],
  "insights": "노트에 대한 전반적인 통찰"
}`;

const QUICK_DRAFT_PROMPT = `당신은 지식 관리 전문가입니다. 사용자의 요청에 따라 기존 노트들의 컨텍스트를 활용하여 새로운 콘텐츠를 작성합니다.

## 관련 노트 컨텍스트
{context}

## 사용자 요청
{userPrompt}

## 지침
1. 관련 노트들의 스타일과 용어를 일관되게 사용하세요
2. 기존 노트와의 연결점을 명시적으로 언급하세요
3. [[노트명]] 형식의 위키링크를 적절히 사용하세요
4. 마크다운 형식으로 작성하세요`;

// ============================================
// Connection Analyzer
// ============================================

export class ConnectionAnalyzer {
  private vault: Vault;
  private database: Database;
  private providerManager: AIProviderManager;
  private embeddingService: EmbeddingService;
  private settings: OSBASettings;

  constructor(
    vault: Vault,
    database: Database,
    providerManager: AIProviderManager,
    embeddingService: EmbeddingService,
    settings: OSBASettings
  ) {
    this.vault = vault;
    this.database = database;
    this.providerManager = providerManager;
    this.embeddingService = embeddingService;
    this.settings = settings;
  }

  updateSettings(settings: OSBASettings): void {
    this.settings = settings;
  }

  // ============================================
  // Note Analysis
  // ============================================

  /**
   * 노트 분석 수행
   */
  async analyzeNote(file: TFile): Promise<AnalysisResult> {
    // 예산 체크
    await this.checkBudget();

    const content = await this.vault.cachedRead(file);

    // 유사한 노트 찾기
    const similarNotes = await this.embeddingService.findSimilarNotes(file, 10);

    // 관련 노트 컨텍스트 구성
    const relatedNotesContext = await this.buildRelatedNotesContext(similarNotes);

    // 프롬프트 구성
    const prompt = ANALYSIS_PROMPT
      .replace('{title}', file.basename)
      .replace('{content}', this.truncateContent(content, 4000))
      .replace('{relatedNotes}', relatedNotesContext);

    // LLM 호출
    const result = await this.providerManager.generateText(
      this.settings.analysisModel,
      prompt,
      {
        systemPrompt: ANALYSIS_SYSTEM_PROMPT,
        maxTokens: 8000,  // Fixed: was 2000, increased to prevent response truncation
        temperature: 0.3, // 더 일관된 응답을 위해 낮은 temperature
      }
    );

    // 사용량 로깅
    await this.logUsage(result, 'analysis', file.path);

    // 응답 파싱
    const parsed = this.parseAnalysisResponse(result.text);

    // 노트 ID 조회
    const noteId = await this.getNoteId(file.path);

    // 연결 저장
    for (const conn of parsed.connections) {
      await this.saveConnection(noteId, conn);
    }

    // 지식 갭 저장
    for (const gap of parsed.gaps) {
      await this.saveKnowledgeGap(noteId, gap);
    }

    // 분석 시간 업데이트
    await this.database.updateAnalysisTime(noteId);

    return {
      noteId,
      connections: parsed.connections,
      gaps: parsed.gaps,
      insights: parsed.insights,
      cost: result.cost,
      timestamp: new Date(),
    };
  }

  /**
   * Quick Draft 생성
   */
  async generateQuickDraft(
    userPrompt: string,
    contextPaths?: string[]
  ): Promise<{ content: string; cost: number; relatedNotes: string[] }> {
    // 예산 체크
    await this.checkBudget();

    let context: RAGContext;

    if (contextPaths && contextPaths.length > 0) {
      // 지정된 노트들로 컨텍스트 구성
      context = await this.embeddingService.buildContextFromPaths(contextPaths);
    } else {
      // 쿼리 기반 자동 컨텍스트
      context = await this.embeddingService.buildRAGContext(userPrompt);
    }

    // 컨텍스트 문자열 생성
    const contextString = this.formatContextForPrompt(context);

    // 프롬프트 구성
    const prompt = QUICK_DRAFT_PROMPT
      .replace('{context}', contextString)
      .replace('{userPrompt}', userPrompt);

    // LLM 호출 (빠른 모델 사용)
    const result = await this.providerManager.generateText(
      this.settings.quickDraftModel,
      prompt,
      {
        maxTokens: 4000,
        temperature: 0.7, // 창의적 응답을 위해 적당한 temperature
      }
    );

    // 사용량 로깅
    await this.logUsage(result, 'draft');

    return {
      content: result.text,
      cost: result.cost,
      relatedNotes: context.notes.map(n => n.path),
    };
  }

  // ============================================
  // Helper Methods
  // ============================================

  private async buildRelatedNotesContext(
    similarNotes: { notePath: string; title: string; similarity: number }[]
  ): Promise<string> {
    const parts: string[] = [];

    for (const note of similarNotes.slice(0, 5)) { // 상위 5개만
      const file = this.vault.getAbstractFileByPath(note.notePath);
      if (!(file instanceof TFile)) continue;

      const content = await this.vault.cachedRead(file);
      const truncated = this.truncateContent(content, 1000);

      parts.push(`### ${note.title}
경로: ${note.notePath}
유사도: ${(note.similarity * 100).toFixed(1)}%

${truncated}
---`);
    }

    return parts.join('\n\n');
  }

  private formatContextForPrompt(context: RAGContext): string {
    if (context.notes.length === 0) {
      return '관련 노트가 없습니다.';
    }

    const parts: string[] = [];

    for (const note of context.notes) {
      parts.push(`### ${note.title}
[[${note.path}]]

${this.truncateContent(note.content, 2000)}
---`);
    }

    return parts.join('\n\n');
  }

  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;

    // 문장 경계에서 자르기
    const truncated = content.slice(0, maxLength);
    const lastPeriod = truncated.lastIndexOf('.');
    const lastNewline = truncated.lastIndexOf('\n');
    const breakPoint = Math.max(lastPeriod, lastNewline);

    if (breakPoint > maxLength * 0.8) {
      return truncated.slice(0, breakPoint + 1) + '\n...(truncated)';
    }

    return truncated + '...(truncated)';
  }

  private parseAnalysisResponse(response: string): {
    connections: AnalysisResult['connections'];
    gaps: AnalysisResult['gaps'];
    insights: string;
  } {
    try {
      // Check for empty response
      if (!response || response.trim().length === 0) {
        throw new Error('Empty response from API');
      }

      // Remove code block markers (```json ... ``` or ``` ... ```)
      let cleanedResponse = response
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();

      // JSON 블록 추출
      const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      let jsonString = jsonMatch[0];

      // Fix trailing commas (common LLM error)
      // Replace ", }" with " }" and ", ]" with " ]"
      jsonString = jsonString
        .replace(/,\s*}/g, ' }')
        .replace(/,\s*]/g, ' ]');

      const parsed = JSON.parse(jsonString);

      return {
        connections: (parsed.connections || []).map((c: any) => ({
          targetPath: c.targetPath || '',
          relationType: this.validateRelationType(c.relationType),
          confidence: Math.min(1, Math.max(0, parseFloat(c.confidence) || 0)),
          reasoning: c.reasoning || '',
        })),
        gaps: (parsed.gaps || []).map((g: any) => ({
          topic: g.topic || '',
          description: g.description || '',
          priority: this.validatePriority(g.priority),
          suggestedResources: g.suggestedResources || [],
        })),
        insights: parsed.insights || '',
      };
    } catch (error) {
      console.error('Failed to parse analysis response:', error);
      console.error('Raw response:', response.slice(0, 500));
      return {
        connections: [],
        gaps: [],
        insights: response.slice(0, 500),
      };
    }
  }

  private validateRelationType(type: string): RelationType {
    const validTypes: RelationType[] = ['extends', 'supports', 'contradicts', 'examples', 'related'];
    return validTypes.includes(type as RelationType) ? type as RelationType : 'related';
  }

  private validatePriority(priority: string): GapPriority {
    const validPriorities: GapPriority[] = ['high', 'medium', 'low'];
    return validPriorities.includes(priority as GapPriority) ? priority as GapPriority : 'medium';
  }

  private async getNoteId(path: string): Promise<number> {
    const note = await this.database.getNoteByPath(path);
    if (!note) {
      throw new Error(`Note not found: ${path}`);
    }
    return note.id;
  }

  private async saveConnection(
    sourceNoteId: number,
    connection: AnalysisResult['connections'][0]
  ): Promise<void> {
    // 타겟 노트 ID 조회
    const targetNote = await this.database.getNoteByPath(connection.targetPath);
    if (!targetNote) {
      console.warn(`Target note not found: ${connection.targetPath}`);
      return;
    }

    await this.database.upsertConnection({
      sourceNoteId,
      targetNoteId: targetNote.id,
      relationType: connection.relationType,
      confidence: connection.confidence,
      reasoning: connection.reasoning,
    });
  }

  private async saveKnowledgeGap(
    noteId: number,
    gap: AnalysisResult['gaps'][0]
  ): Promise<void> {
    await this.database.upsertKnowledgeGap({
      noteId,
      topic: gap.topic,
      description: gap.description,
      priority: gap.priority,
      suggestedResources: gap.suggestedResources,
    });
  }

  private async logUsage(
    result: GenerateResult,
    operation: 'generation' | 'embedding' | 'analysis' | 'draft' | 'indexing',
    notePath?: string
  ): Promise<void> {
    // 모델명에서 provider 추출
    let provider: 'gemini' | 'claude' | 'openai' | 'xai' | 'ollama' = 'gemini';
    if (result.model.includes('claude')) {
      provider = 'claude';
    } else if (result.model.includes('gpt') || result.model.includes('embedding')) {
      provider = 'openai';
    } else if (result.model.includes('grok')) {
      provider = 'xai';
    } else if (
      result.cost === 0 &&
      (this.settings.useOllama || result.model.includes('llama') || result.model.includes('gemma') || result.model.includes('nomic'))
    ) {
      provider = 'ollama';
    }

    await this.database.logUsage({
      provider,
      model: result.model,
      operation,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cost: result.cost,
      notePath,
    });
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

  // ============================================
  // Statistics
  // ============================================

  async getAnalysisStats(): Promise<{
    totalConnections: number;
    totalGaps: number;
    analyzedNotes: number;
    pendingAnalysis: number;
  }> {
    return this.database.getAnalysisStats();
  }
}
