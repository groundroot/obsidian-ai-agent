import { requestUrl, RequestUrlParam } from 'obsidian';
import {
  OSBASettings,
  AIProvider,
  GenerateOptions,
  GenerateResult,
  EmbeddingResult,
  ProviderType,
  APIError,
  RateLimitError,
} from '../types';

// ============================================
// Model Configuration
// ============================================

interface ModelConfig {
  id: string;
  provider: ProviderType;
  inputCostPer1M: number;  // USD per 1M tokens
  outputCostPer1M: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  // Gemini Models
  'gemini-flash': {
    id: 'gemini-2.0-flash-exp',
    provider: 'gemini',
    inputCostPer1M: 0.075,
    outputCostPer1M: 0.30,
    maxInputTokens: 1000000,
    maxOutputTokens: 8192,
  },
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',  // Fixed: was gemini-2.5-flash-preview-05-20
    provider: 'gemini',
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.60,
    maxInputTokens: 1048576,  // 1M tokens
    maxOutputTokens: 65536,    // 64K output tokens
  },
  'gemini-2.5-flash-lite': {
    id: 'gemini-2.0-flash-lite',  // Fixed: was gemini-2.5-flash-8b-exp-0924
    provider: 'gemini',
    inputCostPer1M: 0.075,
    outputCostPer1M: 0.30,
    maxInputTokens: 1048576,
    maxOutputTokens: 8192,
  },
  'gemini-pro': {
    id: 'gemini-1.5-pro',
    provider: 'gemini',
    inputCostPer1M: 1.25,
    outputCostPer1M: 5.00,
    maxInputTokens: 2000000,
    maxOutputTokens: 8192,
  },
  'gemini-2.5-pro': {
    id: 'gemini-2.5-pro',  // Added: New Gemini 2.5 Pro model
    provider: 'gemini',
    inputCostPer1M: 1.25,
    outputCostPer1M: 5.00,
    maxInputTokens: 1048576,  // 1M tokens
    maxOutputTokens: 65536,
  },

  // Claude Models
  'claude-sonnet': {
    id: 'claude-3-5-sonnet-20241022',
    provider: 'claude',
    inputCostPer1M: 3.00,
    outputCostPer1M: 15.00,
    maxInputTokens: 200000,
    maxOutputTokens: 8192,
  },
  'claude-opus': {
    id: 'claude-3-opus-20240229',
    provider: 'claude',
    inputCostPer1M: 15.00,
    outputCostPer1M: 75.00,
    maxInputTokens: 200000,
    maxOutputTokens: 4096,
  },
  'claude-sonnet-4': {
    id: 'claude-sonnet-4-20250514',  // Added: Claude Sonnet 4
    provider: 'claude',
    inputCostPer1M: 3.00,
    outputCostPer1M: 15.00,
    maxInputTokens: 200000,
    maxOutputTokens: 16384,
  },
  'claude-opus-4': {
    id: 'claude-opus-4-20250514',  // Added: Claude Opus 4
    provider: 'claude',
    inputCostPer1M: 15.00,
    outputCostPer1M: 75.00,
    maxInputTokens: 200000,
    maxOutputTokens: 16384,
  },
  'claude-opus-4.5': {
    id: 'claude-opus-4-5-20251028',  // Added: Claude Opus 4.5
    provider: 'claude',
    inputCostPer1M: 15.00,
    outputCostPer1M: 75.00,
    maxInputTokens: 200000,
    maxOutputTokens: 16384,
  },

  // xAI Grok Models
  'grok-4-fast': {
    id: 'grok-4-1-fast',
    provider: 'xai',
    inputCostPer1M: 2.00,      // Estimated pricing
    outputCostPer1M: 10.00,
    maxInputTokens: 131072,    // 128K context window
    maxOutputTokens: 131072,   // Large output support
  },

  // OpenAI Text Generation Models (Added)
  'gpt-4.1': {
    id: 'gpt-4.1',
    provider: 'openai',
    inputCostPer1M: 2.00,
    outputCostPer1M: 8.00,
    maxInputTokens: 1047576,
    maxOutputTokens: 32768,
  },
  'gpt-4.1-mini': {
    id: 'gpt-4.1-mini',
    provider: 'openai',
    inputCostPer1M: 0.40,
    outputCostPer1M: 1.60,
    maxInputTokens: 1047576,
    maxOutputTokens: 32768,
  },
  'gpt-4.1-nano': {
    id: 'gpt-4.1-nano',
    provider: 'openai',
    inputCostPer1M: 0.10,
    outputCostPer1M: 0.40,
    maxInputTokens: 1047576,
    maxOutputTokens: 32768,
  },
  'gpt-4o': {
    id: 'gpt-4o',
    provider: 'openai',
    inputCostPer1M: 2.50,
    outputCostPer1M: 10.00,
    maxInputTokens: 128000,
    maxOutputTokens: 16384,
  },

  // OpenAI Embedding Models
  'openai-small': {
    id: 'text-embedding-3-small',
    provider: 'openai',
    inputCostPer1M: 0.02,
    outputCostPer1M: 0,
    maxInputTokens: 8191,
    maxOutputTokens: 0,
  },
  'openai-large': {
    id: 'text-embedding-3-large',
    provider: 'openai',
    inputCostPer1M: 0.13,
    outputCostPer1M: 0,
    maxInputTokens: 8191,
    maxOutputTokens: 0,
  },
};

// ============================================
// API Endpoints
// ============================================

const API_ENDPOINTS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  claude: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  xai: 'https://api.x.ai/v1',  // xAI Grok API endpoint
};

// ============================================
// AI Provider Manager
// ============================================

export class AIProviderManager {
  private settings: OSBASettings;
  private retryDelays = [1000, 2000, 4000]; // Exponential backoff

  constructor(settings: OSBASettings) {
    this.settings = settings;
  }

  updateSettings(settings: OSBASettings): void {
    this.settings = settings;
  }

  // ============================================
  // Text Generation
  // ============================================

  async generateText(
    modelKey: string,
    prompt: string,
    options: GenerateOptions = {}
  ): Promise<GenerateResult> {
    // Check Ollama first (if enabled and model is configured)
    if (this.settings.useOllama && this.settings.ollamaGenerationModel) {
      return this.generateWithOllama(prompt, options);
    }

    // Check for custom model override
    const resolvedModelKey = this.resolveModelKey(modelKey);
    const config = this.getResolvedModelConfig(resolvedModelKey, modelKey);

    if (!config) {
      throw new APIError(`Unknown model: ${modelKey}`, 'gemini', 400);
    }

    switch (config.provider) {
      case 'gemini':
        return this.generateWithGemini(config, prompt, options);
      case 'claude':
        return this.generateWithClaude(config, prompt, options);
      case 'xai':
        return this.generateWithXAI(config, prompt, options);
      case 'openai':
        return this.generateTextWithOpenAI(config, prompt, options);
      default:
        throw new APIError(`Provider ${config.provider} does not support text generation`, config.provider, 400);
    }
  }

  // Resolve model key with custom model support
  private resolveModelKey(modelKey: string): string {
    if (!this.settings.useCustomModels) {
      return modelKey;
    }

    // Map standard model keys to custom models if configured
    if (modelKey === this.settings.quickDraftModel && this.settings.customQuickDraftModel) {
      return this.settings.customQuickDraftModel;
    }
    if (modelKey === this.settings.analysisModel && this.settings.customAnalysisModel) {
      return this.settings.customAnalysisModel;
    }

    return modelKey;
  }

  // Get model config, supporting custom model IDs
  private getResolvedModelConfig(resolvedKey: string, originalKey: string): ModelConfig | undefined {
    // First check if it's a known model key
    if (MODEL_CONFIGS[resolvedKey]) {
      return MODEL_CONFIGS[resolvedKey];
    }

    // If custom model, create a dynamic config based on the original model type
    if (this.settings.useCustomModels && resolvedKey !== originalKey) {
      const baseConfig = MODEL_CONFIGS[originalKey];
      if (baseConfig) {
        return {
          ...baseConfig,
          id: resolvedKey,  // Use custom model ID
        };
      }
    }

    // Fallback to original key
    return MODEL_CONFIGS[originalKey];
  }

  private async generateWithGemini(
    config: ModelConfig,
    prompt: string,
    options: GenerateOptions
  ): Promise<GenerateResult> {
    const apiKey = this.settings.geminiApiKey;
    if (!apiKey) {
      throw new APIError('Gemini API key not configured', 'gemini', 401);
    }

    const url = `${API_ENDPOINTS.gemini}/models/${config.id}:generateContent?key=${apiKey}`;

    const body = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        maxOutputTokens: options.maxTokens || config.maxOutputTokens,
        temperature: options.temperature ?? 0.7,
        topP: options.topP ?? 0.95,
        stopSequences: options.stopSequences || [],
      },
    };

    if (options.systemPrompt) {
      body.contents.unshift({
        role: 'user',
        parts: [{ text: `System: ${options.systemPrompt}` }]
      } as any);
    }

    const response = await this.makeRequest({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 'gemini');

    const data = JSON.parse(response);

    if (!data.candidates || data.candidates.length === 0) {
      throw new APIError('No response from Gemini', 'gemini', 500);
    }

    const candidate = data.candidates[0];
    const text = candidate.content?.parts?.[0]?.text || '';

    // Estimate tokens (Gemini doesn't always return token counts)
    const inputTokens = data.usageMetadata?.promptTokenCount || this.estimateTokens(prompt);
    const outputTokens = data.usageMetadata?.candidatesTokenCount || this.estimateTokens(text);

    return {
      text,
      inputTokens,
      outputTokens,
      cost: this.calculateCost(config, inputTokens, outputTokens),
      model: config.id,
      finishReason: candidate.finishReason === 'STOP' ? 'stop' : 'length',
    };
  }

  private async generateWithClaude(
    config: ModelConfig,
    prompt: string,
    options: GenerateOptions
  ): Promise<GenerateResult> {
    const apiKey = this.settings.claudeApiKey;
    if (!apiKey) {
      throw new APIError('Claude API key not configured', 'claude', 401);
    }

    const url = `${API_ENDPOINTS.claude}/messages`;

    const body: Record<string, unknown> = {
      model: config.id,
      max_tokens: options.maxTokens || config.maxOutputTokens,
      messages: [{ role: 'user', content: prompt }],
    };

    if (options.systemPrompt) {
      body.system = options.systemPrompt;
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    if (options.topP !== undefined) {
      body.top_p = options.topP;
    }

    if (options.stopSequences) {
      body.stop_sequences = options.stopSequences;
    }

    const response = await this.makeRequest({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    }, 'claude');

    const data = JSON.parse(response);

    const text = data.content?.[0]?.text || '';

    return {
      text,
      inputTokens: data.usage?.input_tokens || 0,
      outputTokens: data.usage?.output_tokens || 0,
      cost: this.calculateCost(config, data.usage?.input_tokens || 0, data.usage?.output_tokens || 0),
      model: config.id,
      finishReason: data.stop_reason === 'end_turn' ? 'stop' : 'length',
    };
  }

  private async generateWithXAI(
    config: ModelConfig,
    prompt: string,
    options: GenerateOptions
  ): Promise<GenerateResult> {
    const apiKey = this.settings.xaiApiKey;
    if (!apiKey) {
      throw new APIError('xAI API key not configured', 'xai', 401);
    }

    const url = `${API_ENDPOINTS.xai}/chat/completions`;

    const messages: Array<{ role: string; content: string }> = [];

    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    const body: Record<string, unknown> = {
      model: config.id,
      messages,
      max_tokens: options.maxTokens || config.maxOutputTokens,
    };

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    if (options.topP !== undefined) {
      body.top_p = options.topP;
    }

    if (options.stopSequences && options.stopSequences.length > 0) {
      body.stop = options.stopSequences;
    }

    const response = await this.makeRequest({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    }, 'xai');

    const data = JSON.parse(response);

    if (!data.choices || data.choices.length === 0) {
      throw new APIError('No response from xAI', 'xai', 500);
    }

    const choice = data.choices[0];
    const text = choice.message?.content || '';

    const inputTokens = data.usage?.prompt_tokens || this.estimateTokens(prompt);
    const outputTokens = data.usage?.completion_tokens || this.estimateTokens(text);

    return {
      text,
      inputTokens,
      outputTokens,
      cost: this.calculateCost(config, inputTokens, outputTokens),
      model: config.id,
      finishReason: choice.finish_reason === 'stop' ? 'stop' : 'length',
    };
  }

  private async generateTextWithOpenAI(
    config: ModelConfig,
    prompt: string,
    options: GenerateOptions
  ): Promise<GenerateResult> {
    const apiKey = this.settings.openaiApiKey;
    if (!apiKey) {
      throw new APIError('OpenAI API key not configured', 'openai', 401);
    }

    const url = `${API_ENDPOINTS.openai}/chat/completions`;

    const messages: Array<{ role: string; content: string }> = [];

    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    const body: Record<string, unknown> = {
      model: config.id,
      messages,
      max_tokens: options.maxTokens || config.maxOutputTokens,
    };

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    if (options.topP !== undefined) {
      body.top_p = options.topP;
    }

    if (options.stopSequences && options.stopSequences.length > 0) {
      body.stop = options.stopSequences;
    }

    const response = await this.makeRequest({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    }, 'openai');

    const data = JSON.parse(response);

    if (!data.choices || data.choices.length === 0) {
      throw new APIError('No response from OpenAI', 'openai', 500);
    }

    const choice = data.choices[0];
    const text = choice.message?.content || '';

    const inputTokens = data.usage?.prompt_tokens || this.estimateTokens(prompt);
    const outputTokens = data.usage?.completion_tokens || this.estimateTokens(text);

    return {
      text,
      inputTokens,
      outputTokens,
      cost: this.calculateCost(config, inputTokens, outputTokens),
      model: config.id,
      finishReason: choice.finish_reason === 'stop' ? 'stop' : 'length',
    };
  }

  // ============================================
  // Embedding Generation
  // ============================================

  async generateEmbedding(text: string, modelKey?: string): Promise<EmbeddingResult> {
    // Check Ollama first (if enabled and model is configured)
    if (this.settings.useOllama && this.settings.ollamaEmbeddingModel) {
      return this.generateEmbeddingWithOllama(text);
    }

    const model = modelKey || this.settings.embeddingModel;
    const config = MODEL_CONFIGS[model];

    if (!config || config.provider !== 'openai') {
      throw new APIError('Invalid embedding model', 'openai', 400);
    }

    return this.generateWithOpenAI(config, text);
  }

  private async generateWithOpenAI(
    config: ModelConfig,
    text: string
  ): Promise<EmbeddingResult> {
    const apiKey = this.settings.openaiApiKey;
    if (!apiKey) {
      throw new APIError('OpenAI API key not configured', 'openai', 401);
    }

    const url = `${API_ENDPOINTS.openai}/embeddings`;

    // Truncate text if too long
    const truncatedText = text.length > 8000 * 4 ? text.slice(0, 8000 * 4) : text;

    const body = {
      model: config.id,
      input: truncatedText,
    };

    const response = await this.makeRequest({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    }, 'openai');

    const data = JSON.parse(response);

    if (!data.data || data.data.length === 0) {
      throw new APIError('No embedding returned from OpenAI', 'openai', 500);
    }

    const embedding = data.data[0].embedding;
    const inputTokens = data.usage?.total_tokens || this.estimateTokens(truncatedText);

    return {
      embedding,
      inputTokens,
      cost: this.calculateCost(config, inputTokens, 0),
      model: config.id,
      dimensions: embedding.length,
    };
  }

  // ============================================
  // Ollama Support
  // ============================================

  private async generateWithOllama(
    prompt: string,
    options: GenerateOptions
  ): Promise<GenerateResult> {
    const url = `${this.settings.ollamaBaseUrl}/v1/chat/completions`;

    const body = {
      model: this.settings.ollamaGenerationModel,
      messages: [{
        role: 'user',
        content: prompt
      }],
      temperature: options.temperature ?? 0.7,
      top_p: options.topP ?? 0.95,
      max_tokens: options.maxTokens || 2048,
    };

    const response = await this.makeRequest({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, 'ollama');

    const data = JSON.parse(response);

    if (!data.choices || data.choices.length === 0) {
      throw new APIError('No response from Ollama', 'ollama', 500);
    }

    const choice = data.choices[0];
    const text = choice.message?.content || '';

    const inputTokens = data.usage?.prompt_tokens || this.estimateTokens(prompt);
    const outputTokens = data.usage?.completion_tokens || this.estimateTokens(text);

    return {
      text,
      inputTokens,
      outputTokens,
      cost: 0,  // Ollama is free (local)
      model: this.settings.ollamaGenerationModel,
      finishReason: choice.finish_reason === 'stop' ? 'stop' : 'length',
    };
  }

  private async generateEmbeddingWithOllama(text: string): Promise<EmbeddingResult> {
    const url = `${this.settings.ollamaBaseUrl}/v1/embeddings`;

    // Truncate text if too long
    const truncatedText = text.length > 8000 * 4 ? text.slice(0, 8000 * 4) : text;

    const body = {
      model: this.settings.ollamaEmbeddingModel,
      input: truncatedText,
    };

    const response = await this.makeRequest({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, 'ollama');

    const data = JSON.parse(response);

    if (!data.data || data.data.length === 0) {
      throw new APIError('No embedding returned from Ollama', 'ollama', 500);
    }

    const embedding = data.data[0].embedding;
    const inputTokens = data.usage?.total_tokens || this.estimateTokens(truncatedText);

    return {
      embedding,
      inputTokens,
      cost: 0,  // Ollama is free (local)
      model: this.settings.ollamaEmbeddingModel,
      dimensions: embedding.length,
    };
  }

  async listOllamaModels(): Promise<string[]> {
    if (!this.settings.useOllama || !this.settings.ollamaBaseUrl) {
      return [];
    }

    try {
      const response = await this.makeRequest({
        url: `${this.settings.ollamaBaseUrl}/api/tags`,
        method: 'GET',
      }, 'ollama');

      const data = JSON.parse(response);
      return data.models?.map((m: any) => m.name) || [];
    } catch (error) {
      console.error('Failed to list Ollama models:', error);
      return [];
    }
  }

  // ============================================
  // Request Handling with Retry
  // ============================================

  private async makeRequest(
    params: RequestUrlParam,
    provider: ProviderType,
    retryCount: number = 0
  ): Promise<string> {
    try {
      const response = await requestUrl(params);

      if (response.status >= 200 && response.status < 300) {
        return response.text;
      }

      // Handle specific error codes
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers['retry-after'] || '60');
        throw new RateLimitError(provider, retryAfter);
      }

      if (response.status === 401 || response.status === 403) {
        throw new APIError('Invalid API key', provider, response.status, false);
      }

      throw new APIError(
        `API request failed: ${response.status}`,
        provider,
        response.status
      );

    } catch (error) {
      if (error instanceof RateLimitError || error instanceof APIError) {
        // Retry if recoverable and we haven't exceeded retry limit
        if (error.recoverable && retryCount < this.retryDelays.length) {
          const delay = error instanceof RateLimitError
            ? (error.retryAfter || 60) * 1000
            : this.retryDelays[retryCount];

          console.log(`Retrying ${provider} request in ${delay}ms...`);
          await this.sleep(delay);
          return this.makeRequest(params, provider, retryCount + 1);
        }
        throw error;
      }

      // Network or other errors
      if (retryCount < this.retryDelays.length) {
        await this.sleep(this.retryDelays[retryCount]);
        return this.makeRequest(params, provider, retryCount + 1);
      }

      throw new APIError(
        `Network error: ${error instanceof Error ? error.message : 'Unknown'}`,
        provider,
        0
      );
    }
  }

  // ============================================
  // Utility Methods
  // ============================================

  private calculateCost(
    config: ModelConfig,
    inputTokens: number,
    outputTokens: number
  ): number {
    const inputCost = (inputTokens / 1000000) * config.inputCostPer1M;
    const outputCost = (outputTokens / 1000000) * config.outputCostPer1M;
    return inputCost + outputCost;
  }

  private estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token for English
    // More accurate for mixed content
    return Math.ceil(text.length / 4);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================
  // Provider Availability
  // ============================================

  async testConnection(provider: ProviderType): Promise<{ success: boolean; error?: string }> {
    try {
      switch (provider) {
        case 'gemini':
          if (!this.settings.geminiApiKey) {
            return { success: false, error: 'API key not set' };
          }
          await this.generateText('gemini-flash', 'Say "OK"', { maxTokens: 10 });
          return { success: true };

        case 'claude':
          if (!this.settings.claudeApiKey) {
            return { success: false, error: 'API key not set' };
          }
          await this.generateText('claude-sonnet', 'Say "OK"', { maxTokens: 10 });
          return { success: true };

        case 'openai':
          if (!this.settings.openaiApiKey) {
            return { success: false, error: 'API key not set' };
          }
          await this.generateEmbedding('test');
          return { success: true };

        case 'xai':
          if (!this.settings.xaiApiKey) {
            return { success: false, error: 'API key not set' };
          }
          await this.generateText('grok-4-fast', 'Say "OK"', { maxTokens: 10 });
          return { success: true };

        case 'ollama':
          if (!this.settings.ollamaBaseUrl) {
            return { success: false, error: 'Base URL not set' };
          }
          try {
            const response = await requestUrl({
              url: `${this.settings.ollamaBaseUrl}/api/tags`,
              method: 'GET',
            });
            if (response.status >= 200 && response.status < 300) {
              return { success: true };
            }
            return { success: false, error: `HTTP ${response.status}` };
          } catch (err) {
            return { success: false, error: 'Cannot connect to Ollama' };
          }

        default:
          return { success: false, error: 'Unknown provider' };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed'
      };
    }
  }

  isProviderConfigured(provider: ProviderType): boolean {
    switch (provider) {
      case 'gemini':
        return !!this.settings.geminiApiKey;
      case 'claude':
        return !!this.settings.claudeApiKey;
      case 'openai':
        return !!this.settings.openaiApiKey;
      case 'xai':
        return !!this.settings.xaiApiKey;
      case 'ollama':
        return this.settings.useOllama && !!this.settings.ollamaBaseUrl;
      default:
        return false;
    }
  }

  getModelConfig(modelKey: string): ModelConfig | undefined {
    return MODEL_CONFIGS[modelKey];
  }

  getAvailableModels(type: 'generation' | 'embedding'): string[] {
    return Object.entries(MODEL_CONFIGS)
      .filter(([_, config]) => {
        if (type === 'embedding') {
          return config.provider === 'openai';
        }
        return config.provider === 'gemini' || config.provider === 'claude' || config.provider === 'xai';
      })
      .filter(([_, config]) => this.isProviderConfigured(config.provider))
      .map(([key, _]) => key);
  }
}
