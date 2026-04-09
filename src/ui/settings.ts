/**
 * Settings Tab
 * Obsidian 플러그인 설정 UI
 */

import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type OSBAPlugin from '../main';
import { OSBASettings, DEFAULT_SETTINGS, ProviderType } from '../types';
import { ProgressModal } from './progress-modal';

export class OSBASettingTab extends PluginSettingTab {
  plugin: OSBAPlugin;

  constructor(app: App, plugin: OSBAPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h1', { text: 'Second Brain Agent 설정' });

    // ============================================
    // Ollama Settings Section
    // ============================================

    containerEl.createEl('h2', { text: '🦙 Ollama (로컬 모델)' });

    new Setting(containerEl)
      .setName('Ollama 사용')
      .setDesc('로컬 Ollama 모델 사용 여부')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useOllama)
        .onChange(async (value) => {
          this.plugin.settings.useOllama = value;
          await this.plugin.saveSettings();
          this.display(); // 화면 새로고침
        }));

    if (this.plugin.settings.useOllama) {
      // Ollama URL 설정
      new Setting(containerEl)
        .setName('Ollama Base URL')
        .setDesc('Ollama API 서버 주소')
        .addText(text => text
          .setPlaceholder('http://localhost:11434')
          .setValue(this.plugin.settings.ollamaBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.ollamaBaseUrl = value;
            await this.plugin.saveSettings();
            // URL 변경 시 모델 목록 갱신
            this.display();
          }))
        .addButton(button => button
          .setButtonText('연결 테스트')
          .onClick(async () => {
            const result = await this.plugin.providerManager.testConnection('ollama');
            if (result.success) {
              new Notice('✅ Ollama 연결 성공!');
            } else {
              new Notice(`❌ Ollama 연결 실패: ${result.error}`);
            }
          }));

      // 모델 로드 상태 표시
      const statusDiv = containerEl.createDiv();
      statusDiv.style.marginBottom = '1rem';
      statusDiv.style.padding = '0.75rem';
      statusDiv.style.borderRadius = '4px';
      statusDiv.style.backgroundColor = 'var(--background-secondary)';

      const statusText = statusDiv.createEl('p');
      statusText.style.margin = '0';
      statusText.style.fontSize = '0.9em';

      try {
        statusText.innerHTML = '🔄 Ollama 모델 로드 중...';
        const models = await this.plugin.providerManager.listOllamaModels();

        if (models.length === 0) {
          statusText.innerHTML = '⚠️ 설치된 모델이 없습니다. Ollama에서 모델을 먼저 설치하세요.';
          statusText.style.color = '#ffa500';
        } else {
          statusText.innerHTML = `✅ ${models.length}개 모델 발견: ${models.join(', ')}`;
          statusText.style.color = '#4CAF50';
        }
      } catch (error) {
        statusText.innerHTML = '❌ 모델 목록을 불러올 수 없습니다.';
        statusText.style.color = '#ff6b6b';
      }

      // Generation Model 선택
      const genModels = await this.plugin.providerManager.listOllamaModels();

      new Setting(containerEl)
        .setName('Generation Model')
        .setDesc('텍스트 생성에 사용할 모델');

      if (genModels.length > 0) {
        new Setting(containerEl)
          .addDropdown(dropdown => {
            dropdown.addOption('', '-- 모델 선택 --');
            genModels.forEach(model => {
              dropdown.addOption(model, model);
            });
            dropdown.setValue(this.plugin.settings.ollamaGenerationModel || '');
            dropdown.onChange(async (value) => {
              if (value) {
                this.plugin.settings.ollamaGenerationModel = value;
                await this.plugin.saveSettings();
              }
            });
          });
      } else {
        new Setting(containerEl)
          .addText(text => text
            .setPlaceholder('예: gemma:2b')
            .setValue(this.plugin.settings.ollamaGenerationModel)
            .onChange(async (value) => {
              this.plugin.settings.ollamaGenerationModel = value;
              await this.plugin.saveSettings();
            }));
      }

      // Embedding Model 선택
      new Setting(containerEl)
        .setName('Embedding Model')
        .setDesc('벡터 임베딩에 사용할 모델 (nomic-embed-text 권장)');

      if (genModels.length > 0) {
        new Setting(containerEl)
          .addDropdown(dropdown => {
            dropdown.addOption('', '-- 모델 선택 --');
            genModels.forEach(model => {
              dropdown.addOption(model, model);
            });
            dropdown.setValue(this.plugin.settings.ollamaEmbeddingModel || '');
            dropdown.onChange(async (value) => {
              if (value) {
                this.plugin.settings.ollamaEmbeddingModel = value;
                await this.plugin.saveSettings();
              }
            });
          });
      } else {
        new Setting(containerEl)
          .addText(text => text
            .setPlaceholder('예: nomic-embed-text')
            .setValue(this.plugin.settings.ollamaEmbeddingModel)
            .onChange(async (value) => {
              this.plugin.settings.ollamaEmbeddingModel = value;
              await this.plugin.saveSettings();
            }));
      }
    }

    // ============================================
    // API Keys Section
    // ============================================

    containerEl.createEl('h2', { text: '🔑 API 키 설정' });

    new Setting(containerEl)
      .setName('Gemini API Key')
      .setDesc('Google AI Studio에서 발급받은 API 키')
      .addText(text => text
        .setPlaceholder('Enter Gemini API key')
        .setValue(this.plugin.settings.geminiApiKey)
        .onChange(async (value) => {
          this.plugin.settings.geminiApiKey = value;
          await this.plugin.saveSettings();
        }))
      .addButton(button => button
        .setButtonText('테스트')
        .onClick(async () => {
          await this.testConnection('gemini');
        }));

    new Setting(containerEl)
      .setName('Claude API Key')
      .setDesc('Anthropic Console에서 발급받은 API 키')
      .addText(text => text
        .setPlaceholder('Enter Claude API key')
        .setValue(this.plugin.settings.claudeApiKey)
        .onChange(async (value) => {
          this.plugin.settings.claudeApiKey = value;
          await this.plugin.saveSettings();
        }))
      .addButton(button => button
        .setButtonText('테스트')
        .onClick(async () => {
          await this.testConnection('claude');
        }));

    new Setting(containerEl)
      .setName('OpenAI API Key')
      .setDesc('OpenAI Platform에서 발급받은 API 키 (임베딩용)')
      .addText(text => text
        .setPlaceholder('Enter OpenAI API key')
        .setValue(this.plugin.settings.openaiApiKey)
        .onChange(async (value) => {
          this.plugin.settings.openaiApiKey = value;
          await this.plugin.saveSettings();
        }))
      .addButton(button => button
        .setButtonText('테스트')
        .onClick(async () => {
          await this.testConnection('openai');
        }));

    new Setting(containerEl)
      .setName('xAI API Key')
      .setDesc('xAI Console에서 발급받은 API 키 (Grok 모델용, 128K 컨텍스트)')
      .addText(text => text
        .setPlaceholder('Enter xAI API key')
        .setValue(this.plugin.settings.xaiApiKey)
        .onChange(async (value) => {
          this.plugin.settings.xaiApiKey = value;
          await this.plugin.saveSettings();
        }))
      .addButton(button => button
        .setButtonText('테스트')
        .onClick(async () => {
          await this.testConnection('xai');
        }));

    // ============================================
    // Model Selection Section
    // ============================================

    containerEl.createEl('h2', { text: '🤖 모델 선택' });

    new Setting(containerEl)
      .setName('Quick Draft 모델')
      .setDesc('빠른 초안 작성에 사용할 모델 (속도 우선) - 2025년 12월 기준')
      .addDropdown(dropdown => dropdown
        .addOption('gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite ($0.10/1M, 가장 저렴)')
        .addOption('gemini-2.5-flash', 'Gemini 2.5 Flash ($0.15/1M, 1M 컨텍스트)')
        .addOption('gpt-4.1-nano', 'GPT-4.1 nano (가장 빠름, 1M 컨텍스트)')
        .addOption('gpt-4.1-mini', 'GPT-4.1 mini ($0.40/1M, 1M 컨텍스트)')
        .addOption('claude-sonnet-4', 'Claude Sonnet 4 ($3.00/1M)')
        .addOption('grok-4-fast', 'Grok 4.1 Fast ($2.00/1M, 128K 컨텍스트)')
        .setValue(this.plugin.settings.quickDraftModel)
        .onChange(async (value) => {
          this.plugin.settings.quickDraftModel = value as 'gemini-2.5-flash-lite' | 'gemini-2.5-flash' | 'gpt-4.1-nano' | 'gpt-4.1-mini' | 'claude-sonnet-4' | 'grok-4-fast';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('분석 모델')
      .setDesc('노트 분석 및 연결 탐색에 사용할 모델 (품질 우선) - 2025년 12월 기준')
      .addDropdown(dropdown => dropdown
        .addOption('claude-sonnet-4', 'Claude Sonnet 4 ($3.00/1M)')
        .addOption('claude-opus-4', 'Claude Opus 4 ($15.00/1M)')
        .addOption('claude-opus-4.5', 'Claude Opus 4.5 ($5.00/1M, 최신)')
        .addOption('gemini-2.5-pro', 'Gemini 2.5 Pro ($1.25/1M, 1M 컨텍스트)')
        .addOption('gpt-4.1', 'GPT-4.1 ($2.00/1M, 1M 컨텍스트)')
        .addOption('gpt-4o', 'GPT-4o ($2.50/1M)')
        .addOption('grok-4-fast', 'Grok 4.1 Fast ($2.00/1M, 128K 컨텍스트)')
        .setValue(this.plugin.settings.analysisModel)
        .onChange(async (value) => {
          this.plugin.settings.analysisModel = value as 'claude-sonnet-4' | 'claude-opus-4' | 'claude-opus-4.5' | 'gemini-2.5-pro' | 'gpt-4.1' | 'gpt-4o' | 'grok-4-fast';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('임베딩 모델')
      .setDesc('벡터 임베딩 생성에 사용할 모델')
      .addDropdown(dropdown => dropdown
        .addOption('openai-small', 'text-embedding-3-small ($0.02/1M)')
        .addOption('openai-large', 'text-embedding-3-large ($0.13/1M)')
        .setValue(this.plugin.settings.embeddingModel)
        .onChange(async (value) => {
          this.plugin.settings.embeddingModel = value as 'openai-small' | 'openai-large';
          await this.plugin.saveSettings();
        }));

    // ============================================
    // Custom Model Settings Section
    // ============================================

    containerEl.createEl('h2', { text: '🔧 커스텀 모델 설정' });
    containerEl.createEl('p', {
      text: '드롭다운에 없는 모델을 직접 지정하려면 아래 설정을 활성화하세요.',
      cls: 'setting-item-description'
    });

    new Setting(containerEl)
      .setName('커스텀 모델 사용')
      .setDesc('활성화하면 드롭다운 선택을 무시하고 아래 입력한 모델명을 사용합니다')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useCustomModels)
        .onChange(async (value) => {
          this.plugin.settings.useCustomModels = value;
          await this.plugin.saveSettings();
          this.display(); // 화면 새로고침하여 커스텀 필드 표시/숨김
        }));

    if (this.plugin.settings.useCustomModels) {
      new Setting(containerEl)
        .setName('Quick Draft 커스텀 모델')
        .setDesc('예: grok-4, gemini-2.5-flash-preview-05-20')
        .addText(text => text
          .setPlaceholder('모델 ID를 직접 입력')
          .setValue(this.plugin.settings.customQuickDraftModel)
          .onChange(async (value) => {
            this.plugin.settings.customQuickDraftModel = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('분석 커스텀 모델')
        .setDesc('예: claude-3-5-sonnet-20241022, grok-4')
        .addText(text => text
          .setPlaceholder('모델 ID를 직접 입력')
          .setValue(this.plugin.settings.customAnalysisModel)
          .onChange(async (value) => {
            this.plugin.settings.customAnalysisModel = value;
            await this.plugin.saveSettings();
          }));
    }

    // ============================================
    // Budget Settings Section
    // ============================================

    containerEl.createEl('h2', { text: '💰 예산 관리' });

    new Setting(containerEl)
      .setName('일일 예산 한도 (USD)')
      .setDesc('하루 최대 API 사용 금액')
      .addText(text => text
        .setPlaceholder('1.00')
        .setValue(this.plugin.settings.dailyBudgetLimit.toString())
        .onChange(async (value) => {
          const parsed = parseFloat(value);
          if (!isNaN(parsed) && parsed > 0) {
            this.plugin.settings.dailyBudgetLimit = parsed;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('월간 예산 한도 (USD)')
      .setDesc('한 달 최대 API 사용 금액')
      .addText(text => text
        .setPlaceholder('10.00')
        .setValue(this.plugin.settings.monthlyBudgetLimit.toString())
        .onChange(async (value) => {
          const parsed = parseFloat(value);
          if (!isNaN(parsed) && parsed > 0) {
            this.plugin.settings.monthlyBudgetLimit = parsed;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('예산 알림 활성화')
      .setDesc('예산 임계치 도달 시 알림 표시')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableBudgetAlerts)
        .onChange(async (value) => {
          this.plugin.settings.enableBudgetAlerts = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('예산 알림 임계치 (%)')
      .setDesc('이 비율에 도달하면 경고 표시')
      .addSlider(slider => slider
        .setLimits(50, 95, 5)
        .setValue(this.plugin.settings.budgetAlertThreshold)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.budgetAlertThreshold = value;
          await this.plugin.saveSettings();
        }));

    // ============================================
    // Processing Settings Section
    // ============================================

    containerEl.createEl('h2', { text: '⚙️ 처리 설정' });

    // 인덱싱 모드 선택
    new Setting(containerEl)
      .setName('인덱싱 모드')
      .setDesc('폴더 인덱싱 방식을 선택하세요')
      .addDropdown(dropdown => dropdown
        .addOption('exclude', '🚫 제외 모드: 지정 폴더만 제외')
        .addOption('include', '✅ 포함 모드: 지정 폴더만 인덱싱')
        .setValue(this.plugin.settings.indexingMode)
        .onChange(async (value) => {
          this.plugin.settings.indexingMode = value as 'exclude' | 'include';
          await this.plugin.saveSettings();
          this.display(); // 화면 새로고침하여 해당 폴더 입력 필드 표시
        }));

    // 인덱싱 모드에 따라 다른 폴더 설정 표시
    if (this.plugin.settings.indexingMode === 'exclude') {
      // 제외 모드: 제외할 폴더 목록
      new Setting(containerEl)
        .setName('제외 폴더')
        .setDesc('임베딩 및 분석에서 제외할 폴더 (쉼표로 구분). 나머지 모든 폴더가 인덱싱됩니다.')
        .addTextArea(text => text
          .setPlaceholder('templates, .obsidian, archive')
          .setValue(this.plugin.settings.excludedFolders.join(', '))
          .onChange(async (value) => {
            this.plugin.settings.excludedFolders = value
              .split(',')
              .map(f => f.trim())
              .filter(f => f.length > 0);
            await this.plugin.saveSettings();
          }));
    } else {
      // 포함 모드: 인덱싱할 폴더 목록
      new Setting(containerEl)
        .setName('포함 폴더')
        .setDesc('임베딩 및 분석에 포함할 폴더만 입력 (쉼표로 구분). 지정한 폴더만 인덱싱됩니다.')
        .addTextArea(text => text
          .setPlaceholder('notes, projects, journal')
          .setValue(this.plugin.settings.includedFolders.join(', '))
          .onChange(async (value) => {
            this.plugin.settings.includedFolders = value
              .split(',')
              .map(f => f.trim())
              .filter(f => f.length > 0);
            await this.plugin.saveSettings();
          }));

      // 포함 모드 안내 메시지
      if (this.plugin.settings.includedFolders.length === 0) {
        containerEl.createEl('p', {
          text: '⚠️ 포함 폴더가 지정되지 않았습니다. 아무 노트도 인덱싱되지 않습니다.',
          cls: 'osba-warning'
        });
      }
    }

    new Setting(containerEl)
      .setName('제외 태그')
      .setDesc('이 태그가 있는 노트는 처리에서 제외 (쉼표로 구분)')
      .addTextArea(text => text
        .setPlaceholder('private, draft, wip')
        .setValue(this.plugin.settings.excludedTags.join(', '))
        .onChange(async (value) => {
          this.plugin.settings.excludedTags = value
            .split(',')
            .map(t => t.trim().replace('#', ''))
            .filter(t => t.length > 0);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('최대 노트 크기 (KB)')
      .setDesc('이 크기보다 큰 노트는 처리에서 제외')
      .addText(text => text
        .setPlaceholder('50')
        .setValue((this.plugin.settings.maxNoteSize / 1024).toString())
        .onChange(async (value) => {
          const parsed = parseInt(value);
          if (!isNaN(parsed) && parsed > 0) {
            this.plugin.settings.maxNoteSize = parsed * 1024;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('배치 처리 크기')
      .setDesc('한 번에 처리할 노트 수')
      .addSlider(slider => slider
        .setLimits(5, 50, 5)
        .setValue(this.plugin.settings.batchSize)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.batchSize = value;
          await this.plugin.saveSettings();
        }));

    // ============================================
    // Feature Toggles Section
    // ============================================

    containerEl.createEl('h2', { text: '🎛️ 기능 토글' });

    new Setting(containerEl)
      .setName('노트 생성 시 자동 분석')
      .setDesc('새 노트 생성 시 자동으로 분석 실행')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoAnalyzeOnCreate)
        .onChange(async (value) => {
          this.plugin.settings.autoAnalyzeOnCreate = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('노트 수정 시 자동 임베딩')
      .setDesc('노트 수정 시 자동으로 임베딩 업데이트')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoEmbedOnModify)
        .onChange(async (value) => {
          this.plugin.settings.autoEmbedOnModify = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('비용 추적 활성화')
      .setDesc('API 사용량 및 비용 추적')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableCostTracking)
        .onChange(async (value) => {
          this.plugin.settings.enableCostTracking = value;
          await this.plugin.saveSettings();
        }));

    // ============================================
    // Advanced Section
    // ============================================

    containerEl.createEl('h2', { text: '🔧 고급 설정' });

    new Setting(containerEl)
      .setName('디버그 모드')
      .setDesc('개발자 콘솔에 상세 로그 출력')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debugMode)
        .onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('캐시 활성화')
      .setDesc('API 응답 및 임베딩 캐싱')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.cacheEnabled)
        .onChange(async (value) => {
          this.plugin.settings.cacheEnabled = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('캐시 TTL (초)')
      .setDesc('캐시 유효 시간')
      .addText(text => text
        .setPlaceholder('3600')
        .setValue(this.plugin.settings.cacheTTL.toString())
        .onChange(async (value) => {
          const parsed = parseInt(value);
          if (!isNaN(parsed) && parsed > 0) {
            this.plugin.settings.cacheTTL = parsed;
            await this.plugin.saveSettings();
          }
        }));

    // ============================================
    // Actions Section
    // ============================================

    containerEl.createEl('h2', { text: '🚀 액션' });

    new Setting(containerEl)
      .setName('전체 볼트 인덱싱')
      .setDesc('모든 노트에 대해 임베딩 생성 (시간이 걸릴 수 있음)')
      .addButton(button => button
        .setButtonText('인덱싱 시작')
        .setCta()
        .onClick(async () => {
          const modal = new ProgressModal(this.app, '볼트 인덱싱');
          modal.open();
          modal.updateState({ message: '인덱싱 준비 중...' });

          try {
            // Job Queue의 진행 상황을 추적
            const files = this.app.vault.getMarkdownFiles()
              .filter((f) => !this.plugin.isExcluded(f));

            const total = files.length;
            let processed = 0;

            modal.updateState({
              message: `총 ${total}개 노트 인덱싱 시작`,
              subMessage: '잠시 기다려주세요...'
            });

            for (const file of files) {
              try {
                await this.plugin.embeddingService?.processNote(file);
                processed++;
                const progress = Math.round((processed / total) * 100);
                modal.updateProgress(progress, `${processed}/${total} 처리 중`);
                modal.updateState({
                  subMessage: file.basename
                });
              } catch (err) {
                console.error(`Failed to index ${file.path}:`, err);
                // Continue with next file
              }
            }

            modal.complete(`✅ ${processed}/${total} 노트 인덱싱 완료!`);
            setTimeout(() => modal.close(), 2000);

          } catch (error) {
            modal.setError(error instanceof Error ? error.message : '인덱싱 실패');
          }
        }));

    new Setting(containerEl)
      .setName('캐시 초기화')
      .setDesc('모든 캐시된 데이터 삭제')
      .addButton(button => button
        .setButtonText('캐시 삭제')
        .setWarning()
        .onClick(async () => {
          if (confirm('모든 캐시를 삭제하시겠습니까?')) {
            const modal = new ProgressModal(this.app, '캐시 초기화');
            modal.open();
            modal.updateProgress(30, '캐시 데이터 삭제 중...');

            try {
              await this.plugin.database?.clearCache();
              modal.updateProgress(100);
              modal.complete('캐시가 삭제되었습니다!');
              setTimeout(() => modal.close(), 1500);
            } catch (error) {
              modal.setError(error instanceof Error ? error.message : '캐시 삭제 실패');
            }
          }
        }));

    new Setting(containerEl)
      .setName('설정 초기화')
      .setDesc('모든 설정을 기본값으로 되돌림')
      .addButton(button => button
        .setButtonText('초기화')
        .setWarning()
        .onClick(async () => {
          if (confirm('모든 설정을 초기화하시겠습니까?')) {
            const modal = new ProgressModal(this.app, '설정 초기화');
            modal.open();
            modal.updateProgress(50, '설정 초기화 중...');

            try {
              this.plugin.settings = { ...DEFAULT_SETTINGS };
              await this.plugin.saveSettings();
              modal.updateProgress(100);
              modal.complete('설정이 초기화되었습니다!');

              setTimeout(() => {
                modal.close();
                this.display(); // 화면 새로고침
              }, 1500);
            } catch (error) {
              modal.setError(error instanceof Error ? error.message : '설정 초기화 실패');
            }
          }
        }));

    // ============================================
    // Statistics Section
    // ============================================

    containerEl.createEl('h2', { text: '📊 통계' });

    this.displayStatistics(containerEl);
  }

  private async displayStatistics(containerEl: HTMLElement): Promise<void> {
    const statsContainer = containerEl.createDiv({ cls: 'osba-stats' });

    // 서비스 초기화 상태 확인
    if (!this.plugin.database || !this.plugin.embeddingService) {
      statsContainer.createEl('p', {
        text: '⏳ 서비스 초기화 중입니다. 잠시 후 설정을 다시 열어주세요.',
        cls: 'osba-warning',
      });
      return;
    }

    try {
      // 로딩 표시
      const loadingEl = statsContainer.createEl('p', {
        text: '통계 로딩 중...',
        cls: 'osba-loading',
      });

      const [indexStats, usageDaily, usageMonthly] = await Promise.all([
        this.plugin.embeddingService.getIndexingStats(),
        this.plugin.database.getUsageSummary('day'),
        this.plugin.database.getUsageSummary('month'),
      ]);

      // 로딩 표시 제거
      loadingEl.remove();

      // 인덱싱 통계
      if (indexStats) {
        statsContainer.createEl('h3', { text: '📁 인덱싱 현황' });
        const indexTable = statsContainer.createEl('table', { cls: 'osba-stats-table' });

        this.addStatRow(indexTable, '전체 노트', `${indexStats.totalNotes}개`);
        this.addStatRow(indexTable, '인덱싱 완료', `${indexStats.indexedNotes}개`);
        this.addStatRow(indexTable, '대기 중', `${indexStats.pendingNotes}개`);

        const progress = indexStats.totalNotes > 0
          ? ((indexStats.indexedNotes / indexStats.totalNotes) * 100).toFixed(1)
          : '0.0';
        this.addStatRow(indexTable, '진행률', `${progress}%`);
      } else {
        statsContainer.createEl('p', {
          text: '인덱싱 통계를 불러올 수 없습니다.',
          cls: 'osba-info',
        });
      }

      // 사용량 통계
      if (usageDaily && usageMonthly) {
        statsContainer.createEl('h3', { text: '💰 API 사용량' });
        const usageTable = statsContainer.createEl('table', { cls: 'osba-stats-table' });

        this.addStatRow(
          usageTable,
          '오늘 사용',
          `$${usageDaily.totalCost.toFixed(4)} / $${this.plugin.settings.dailyBudgetLimit.toFixed(2)}`
        );
        this.addStatRow(
          usageTable,
          '이번 달 사용',
          `$${usageMonthly.totalCost.toFixed(4)} / $${this.plugin.settings.monthlyBudgetLimit.toFixed(2)}`
        );
        this.addStatRow(usageTable, '오늘 요청 수', `${usageDaily.requestCount}회`);
        this.addStatRow(usageTable, '이번 달 요청 수', `${usageMonthly.requestCount}회`);

        // Operation Breakdown
        statsContainer.createEl('h4', { text: '📊 작업별 비용 상세 (일간/월간)' });
        const opTable = statsContainer.createEl('table', { cls: 'osba-stats-table' });

        const operations: Record<string, string> = {
          'embedding': '임베딩/인덱싱',
          'analysis': '노트 분석',
          'draft': '초안 작성',
          'generation': '기타 생성',
          'indexing': '인덱싱'
        };

        const allOps = Array.from(new Set([
          ...Object.keys(usageDaily.byOperation),
          ...Object.keys(usageMonthly.byOperation)
        ])).sort();

        if (allOps.length === 0) {
          this.addStatRow(opTable, '데이터 없음', '-');
        } else {
          for (const op of allOps) {
            const label = operations[op] || op;
            const daily = usageDaily.byOperation[op] || 0;
            const monthly = usageMonthly.byOperation[op] || 0;

            this.addStatRow(opTable, label, `$${daily.toFixed(4)} / $${monthly.toFixed(4)}`);
          }
        }
      } else {
        statsContainer.createEl('p', {
          text: '사용량 통계를 불러올 수 없습니다.',
          cls: 'osba-info',
        });
      }
    } catch (error) {
      console.error('Statistics load error:', error);
      statsContainer.createEl('p', {
        text: `통계를 불러오는 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
        cls: 'osba-error',
      });
    }

    // ============================================
    // Connect with Developer Section
    // ============================================

    containerEl.createEl('h2', { text: '❤️ Connect with Master of Learning (배움의 달인)' });
    const connectContainer = containerEl.createDiv({ cls: 'osba-connect-container' });

    // YouTube Button
    new Setting(connectContainer)
      .setName('YouTube')
      .setDesc('구독하고 더 많은 지식 관리 팁을 확인하세요!')
      .addButton(button => button
        .setButtonText('배움의 달인 채널 방문하기')
        .setCta()
        .onClick(() => {
          window.open('https://www.youtube.com/@%EB%B0%B0%EC%9B%80%EC%9D%98%EB%8B%AC%EC%9D%B8-p5v');
        }));

    // X (Twitter) Button
    new Setting(connectContainer)
      .setName('X (Twitter)')
      .setDesc('최신 업데이트와 인사이트를 팔로우하세요!')
      .addButton(button => button
        .setButtonText('Follow @reallygood83')
        .onClick(() => {
          window.open('https://x.com/reallygood83');
        }));
  }

  private addStatRow(table: HTMLTableElement, label: string, value: string): void {
    const row = table.createEl('tr');
    row.createEl('td', { text: label });
    row.createEl('td', { text: value });
  }

  private async testConnection(provider: ProviderType): Promise<void> {
    new Notice(`${provider} 연결 테스트 중...`);

    try {
      const result = await this.plugin.providerManager.testConnection(provider);

      if (result.success) {
        new Notice(`✅ ${provider} 연결 성공!`);
      } else {
        new Notice(`❌ ${provider} 연결 실패: ${result.error}`);
      }
    } catch (error) {
      new Notice(`❌ 테스트 중 오류 발생: ${error}`);
    }
  }
}
