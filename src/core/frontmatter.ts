/**
 * OSBA Frontmatter Manager
 * Handles YAML frontmatter updates and Insights section management
 */

import { App, TFile, parseYaml, stringifyYaml } from 'obsidian';
import { OSBAFrontmatter, AnalysisResult, RelationType, GapPriority } from '../types';

export class FrontmatterManager {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Update note frontmatter with OSBA analysis results
   */
  async updateNoteFrontmatter(file: TFile, result: AnalysisResult): Promise<void> {
    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.parseFrontmatter(content);
    const existingOsba: OSBAFrontmatter = frontmatter.osba || { version: 1 };

    // Create or update OSBA namespace in frontmatter
    const osbaData: OSBAFrontmatter = {
      ...existingOsba,
      version: 1,
      lastAnalyzed: new Date().toISOString(),
      confidenceScore: this.calculateOverallConfidence(result),
      related: result.connections.map(conn => ({
        path: conn.targetPath,
        score: conn.confidence,
        relation: conn.relationType
      })),
      gaps: result.gaps.map(gap => ({
        topic: gap.topic,
        priority: gap.priority
      }))
    };

    // Merge with existing frontmatter
    const updatedFrontmatter = {
      ...frontmatter,
      osba: osbaData
    };

    // Reconstruct the file
    const newContent = this.buildContent(updatedFrontmatter, body);
    await this.app.vault.modify(file, newContent);
  }

  /**
   * Add or update the Connected Insights section in the note
   */
  async addInsightsSection(file: TFile, result: AnalysisResult): Promise<void> {
    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.parseFrontmatter(content);

    // Generate insights section content
    const insightsContent = this.generateInsightsSection(result);

    // Find and replace existing insights section, or append
    const insightsSectionRegex = /## 🧠 Connected Insights[\s\S]*?(?=\n## |\n---|\Z)/;
    let updatedBody: string;

    if (insightsSectionRegex.test(body)) {
      // Replace existing section
      updatedBody = body.replace(insightsSectionRegex, insightsContent);
    } else {
      // Append at the end
      updatedBody = body.trimEnd() + '\n\n' + insightsContent;
    }

    // Reconstruct the file
    const newContent = this.buildContent(frontmatter, updatedBody);
    await this.app.vault.modify(file, newContent);
  }

  /**
   * Update embedding ID in frontmatter
   */
  async updateEmbeddingId(file: TFile, embeddingId: string): Promise<void> {
    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.parseFrontmatter(content);

    // Get or create OSBA namespace
    const osbaData: OSBAFrontmatter = {
      ...(frontmatter.osba || { version: 1 }),
      version: 1,
    };
    osbaData.embeddingId = embeddingId;

    const updatedFrontmatter = {
      ...frontmatter,
      osba: osbaData
    };

    const newContent = this.buildContent(updatedFrontmatter, body);
    await this.app.vault.modify(file, newContent);
  }

  async updateEmbeddingStatus(
    file: TFile,
    data: {
      embeddingId: string;
      embeddingHash: string;
      embeddingModel: string;
      indexedAt?: string;
      indexStatus?: 'indexed' | 'stale';
    }
  ): Promise<void> {
    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.parseFrontmatter(content);

    const osbaData: OSBAFrontmatter = frontmatter.osba || { version: 1 };
    osbaData.embeddingId = data.embeddingId;
    osbaData.embeddingHash = data.embeddingHash;
    osbaData.embeddingModel = data.embeddingModel;
    osbaData.indexedAt = data.indexedAt || new Date().toISOString();
    osbaData.indexStatus = data.indexStatus || 'indexed';

    const updatedFrontmatter = {
      ...frontmatter,
      osba: osbaData
    };

    const newContent = this.buildContent(updatedFrontmatter, body);
    await this.app.vault.modify(file, newContent);
  }

  async markEmbeddingStale(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.parseFrontmatter(content);
    const osbaData: OSBAFrontmatter = frontmatter.osba || { version: 1 };

    if (!osbaData.embeddingId || osbaData.indexStatus === 'stale') {
      return;
    }

    osbaData.indexStatus = 'stale';

    const updatedFrontmatter = {
      ...frontmatter,
      osba: osbaData
    };

    const newContent = this.buildContent(updatedFrontmatter, body);
    await this.app.vault.modify(file, newContent);
  }

  /**
   * Get OSBA frontmatter data from a note
   */
  async getOSBAFrontmatter(file: TFile): Promise<OSBAFrontmatter | null> {
    const content = await this.app.vault.read(file);
    const { frontmatter } = this.parseFrontmatter(content);
    return frontmatter.osba || null;
  }

  /**
   * Check if note has been analyzed
   */
  async isAnalyzed(file: TFile): Promise<boolean> {
    const osba = await this.getOSBAFrontmatter(file);
    return osba?.lastAnalyzed != null;
  }

  /**
   * Check if note has embedding
   */
  async hasEmbedding(file: TFile): Promise<boolean> {
    const osba = await this.getOSBAFrontmatter(file);
    return osba?.embeddingId != null;
  }

  /**
   * Update similar notes in frontmatter
   * Saves the similar notes to YAML properties for persistent storage
   */
  async updateSimilarNotes(file: TFile, similarNotes: Array<{ title: string; path: string; similarity: number }>): Promise<void> {
    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.parseFrontmatter(content);

    // Get or create OSBA namespace
    const osbaData: OSBAFrontmatter = frontmatter.osba || { version: 1 };

    // Update similar notes with timestamp
    osbaData.similarNotes = similarNotes.map(note => ({
      path: note.path,
      title: note.title,
      similarity: Math.round(note.similarity * 100) / 100 // Round to 2 decimal places
    }));
    osbaData.similarNotesUpdated = new Date().toISOString();

    const updatedFrontmatter = {
      ...frontmatter,
      osba: osbaData
    };

    const newContent = this.buildContent(updatedFrontmatter, body);
    await this.app.vault.modify(file, newContent);
  }

  /**
   * Parse frontmatter from content
   */
  private parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?/;
    const match = content.match(frontmatterRegex);

    if (match) {
      try {
        const frontmatter = parseYaml(match[1]) || {};
        const body = content.slice(match[0].length);
        return { frontmatter, body };
      } catch (e) {
        console.error('Failed to parse frontmatter:', e);
        return { frontmatter: {}, body: content };
      }
    }

    return { frontmatter: {}, body: content };
  }

  /**
   * Build content from frontmatter and body
   */
  private buildContent(frontmatter: Record<string, any>, body: string): string {
    if (Object.keys(frontmatter).length === 0) {
      return body;
    }

    const yamlContent = stringifyYaml(frontmatter).trim();
    return `---\n${yamlContent}\n---\n${body}`;
  }

  /**
   * Generate the Connected Insights section markdown
   */
  private generateInsightsSection(result: AnalysisResult): string {
    const lines: string[] = ['## 🧠 Connected Insights', ''];

    // Analysis timestamp
    lines.push(`> 📅 Last analyzed: ${result.timestamp.toLocaleString('ko-KR')}`);
    lines.push(`> 💰 Analysis cost: $${result.cost.toFixed(4)}`);
    lines.push('');

    // Related Notes
    if (result.connections.length > 0) {
      lines.push('### 🔗 Related Notes');
      lines.push('');

      for (const conn of result.connections) {
        const relationEmoji = this.getRelationEmoji(conn.relationType);
        const confidenceBar = this.getConfidenceBar(conn.confidence);
        lines.push(`- ${relationEmoji} [[${conn.targetPath}]]`);
        lines.push(`  - ${conn.relationType}: ${conn.reasoning}`);
        lines.push(`  - Confidence: ${confidenceBar} (${Math.round(conn.confidence * 100)}%)`);
        lines.push('');
      }
    }

    // Knowledge Gaps
    if (result.gaps.length > 0) {
      lines.push('### 📚 Knowledge Gaps');
      lines.push('');

      for (const gap of result.gaps) {
        const priorityEmoji = this.getPriorityEmoji(gap.priority);
        lines.push(`- ${priorityEmoji} **${gap.topic}**`);
        lines.push(`  - ${gap.description}`);
        if (gap.suggestedResources && gap.suggestedResources.length > 0) {
          lines.push(`  - Suggested resources: ${gap.suggestedResources.join(', ')}`);
        }
        lines.push('');
      }
    }

    // AI Insights
    if (result.insights) {
      lines.push('### 💡 AI Insights');
      lines.push('');
      lines.push(result.insights);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Calculate overall confidence score from connections
   */
  private calculateOverallConfidence(result: AnalysisResult): number {
    if (result.connections.length === 0) return 0;

    const sum = result.connections.reduce((acc, conn) => acc + conn.confidence, 0);
    return sum / result.connections.length;
  }

  /**
   * Get emoji for relation type
   */
  private getRelationEmoji(type: RelationType): string {
    const emojis: Record<RelationType, string> = {
      extends: '🔼',
      supports: '✅',
      contradicts: '⚔️',
      examples: '📝',
      related: '🔗'
    };
    return emojis[type] || '🔗';
  }

  /**
   * Get emoji for priority
   */
  private getPriorityEmoji(priority: GapPriority): string {
    const emojis: Record<GapPriority, string> = {
      high: '🔴',
      medium: '🟡',
      low: '🟢'
    };
    return emojis[priority] || '⚪';
  }

  /**
   * Get visual confidence bar
   */
  private getConfidenceBar(confidence: number): string {
    const filled = Math.round(confidence * 5);
    const empty = 5 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }
}
