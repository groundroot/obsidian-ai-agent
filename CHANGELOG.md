# Changelog

All notable changes to OSBA (Obsidian Second Brain Agent) will be documented in this file.

## [0.3.1] - 2026-04-09

### Fixed
- **Ollama API Compatibility**: Added fallback support for both OpenAI-compatible (`/v1/...`) and native Ollama (`/api/...`) endpoints
  - Text generation now works with `/v1/chat/completions` and falls back to `/api/chat`
  - Embeddings now work with `/v1/embeddings`, `/api/embed`, and legacy `/api/embeddings`
  - System prompts and stop sequences are now passed through to Ollama requests
- **Usage Tracking**: Added full `ollama` provider support to DB schema, migration, and provider usage detection
- **Dashboard Visibility**: Added Ollama and xAI to provider statistics icons and summaries

## [0.3.0] - 2026-04-09

### Added
- **Ollama Local Model Support**: Complete integration of Ollama for free local AI models
  - Auto-discover installed Ollama models via `/api/tags`
  - Support for Generation models (Llama, Gemma, Mistral, etc.)
  - Support for Embedding models (nomic-embed-text recommended)
  - Configurable Ollama Base URL with connection testing
  - Zero-cost AI operations with Ollama
- **Dynamic Settings UI**: Real-time model loading with async display
  - Model selection dropdowns auto-populated from installed models
  - Connection status indicator (🔄 loading, ✅ found, ⚠️ none, ❌ error)
  - Text input fallback when no models available

### Changed
- Updated `src/types/index.ts`: Added `'ollama'` to ProviderType union
- Updated `src/api/provider.ts`: Added Ollama routing in generateText() and generateEmbedding()
- Updated `src/ui/settings.ts`: Made display() async for dynamic model loading

### Technical Details
- Ollama uses OpenAI-compatible API endpoints (`/v1/chat/completions`, `/v1/embeddings`)
- Cost tracking: Ollama models return 0 cost (vs paid APIs)
- Backward compatible: Existing API keys (OpenAI, Gemini, Claude) continue to work
- Hybrid mode: Can mix Ollama + cloud APIs (e.g., Generation: Ollama, Embedding: OpenAI)

## [0.2.3] - 2025-12-20

### Fixed
- **Indexing Not Working**: Fixed critical issue where embeddings were not being created
  - Cause: `embeddings.ts` `isExcluded` method was missing the new indexing mode logic
  - The v0.2.1 indexing mode feature was only implemented in `main.ts` but not in `embeddings.ts`
  - Now both files use consistent logic for `indexingMode`, `includedFolders`, and `maxNoteSize` checks
  - Affected: All embedding/indexing operations were returning 0 indexed notes

## [0.2.2] - 2025-12-20

### Fixed
- **Statistics Load Error**: Fixed TypeError in `isExcluded` method when tags in frontmatter are not strings
  - Error message: `TypeError: u.replace is not a function`
  - Cause: `tag.replace()` was called on non-string tag values in note frontmatter
  - Affected: Settings tab statistics loading

## [0.2.1] - 2025-12-20

### Added
- **Indexing Mode Selection**: Choose between exclude mode (exclude specific folders) or include mode (only index specific folders)
  - 🚫 제외 모드: 지정한 폴더만 제외하고 나머지 모두 인덱싱
  - ✅ 포함 모드: 지정한 폴더만 인덱싱
- **Progress Modal**: Visual progress indicator for long-running operations
  - Animated progress bar with status indicators
  - Support for running, completed, error, and cancelled states
- **Beginner-Friendly README**: Complete documentation rewrite with analogies
  - Library/Librarian analogy for easy understanding
  - Step-by-step setup guide
  - FAQ and troubleshooting sections

### Changed
- Settings UI now dynamically shows exclude/include folder settings based on selected mode
- Warning message when include mode has no folders specified

## [0.2.0] - 2025-01-24

### Added
- **xAI Grok 4 Fast Support**: Added xAI Grok API integration for Quick Draft and Analysis models
- **Gemini 2.5 Flash Support**: Added Google's latest Gemini 2.5 Flash model option
- **Frontmatter Manager**: Complete YAML frontmatter management for OSBA analysis results
  - Automatic frontmatter updates with analysis metadata
  - Connected Insights section generation
  - Embedding ID tracking
- **Enhanced Provider Detection**: Dynamic provider detection for accurate usage logging

### Fixed
- **Provider Logging**: Fixed hardcoded provider issue in generateQuickDraft - now correctly identifies xAI, Claude, OpenAI, and Gemini models
- **Database Schema**: Added 'xai' provider support to CHECK constraint
- **Model Selection**: All model dropdowns now include xAI Grok option

### Changed
- Improved settings UI organization with xAI API key section
- Enhanced error handling across all AI provider integrations

## [0.1.1] - 2025-01-23

### Fixed
- **BRAT Installation Error**: Replaced better-sqlite3 with sql.js (WebAssembly) for cross-platform compatibility
- Fixed native module loading issues that prevented installation via BRAT

## [0.1.0] - 2025-01-22

### Added
- Initial release
- Multi-provider AI support (Gemini, Claude, OpenAI)
- Vector embeddings for semantic note search
- Note connection analysis with LLM
- Knowledge gap discovery
- Cost tracking and budget management
- Quick Draft generation with RAG context
- Status bar with real-time statistics
