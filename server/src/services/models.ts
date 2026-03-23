/**
 * Models.dev API integration
 * Fetches and caches the models.dev catalog to identify AI models
 * used in n8n workflow nodes.
 */

interface ModelsDevModel {
    id: string;
    name: string;
    family?: string;
    modalities?: { input: string[]; output: string[] };
    cost?: { input: number; output: number };
    limit?: { context: number; output: number };
    reasoning?: boolean;
    tool_call?: boolean;
    release_date?: string;
}

interface ModelsDevProvider {
    id: string;
    name: string;
    models: Record<string, ModelsDevModel>;
}

export interface ProviderInfo {
    id: string;
    name: string;
    logoUrl: string;
    modelCount: number;
}

export interface ModelMatch {
    modelId: string;
    modelName: string;
    providerId: string;
    providerName: string;
    logoUrl: string;
    family?: string;
    reasoning?: boolean;
}

// Flat lookup: normalized model name/id -> ModelMatch
const modelLookup = new Map<string, ModelMatch>();

// Provider info cache
const providerCache = new Map<string, ProviderInfo>();

// n8n node type substring -> provider ID mapping
// Ordered specific-first to avoid false matches (e.g. 'AzureOpenAi' before 'OpenAi')
const N8N_NODE_PROVIDER_MAP: [string, string][] = [
    // Azure must come before generic OpenAI
    ['AzureOpenAi', 'azure'],
    ['azureOpenAi', 'azure'],
    // OpenAI (native + langchain)
    ['openAi', 'openai'],
    ['OpenAi', 'openai'],
    ['openai', 'openai'],
    // Anthropic
    ['Anthropic', 'anthropic'],
    ['anthropic', 'anthropic'],
    // Google (Gemini, Vertex, Palm)
    ['GoogleGemini', 'google'],
    ['googleGemini', 'google'],
    ['GoogleVertex', 'google'],
    ['googleVertex', 'google'],
    ['GooglePalm', 'google'],
    ['googlePalm', 'google'],
    // Mistral
    ['MistralCloud', 'mistralai'],
    ['mistralCloud', 'mistralai'],
    ['Mistral', 'mistralai'],
    // Groq
    ['Groq', 'groq'],
    ['groq', 'groq'],
    // DeepSeek
    ['DeepSeek', 'deepseek'],
    ['deepSeek', 'deepseek'],
    // Ollama
    ['Ollama', 'ollama'],
    ['ollama', 'ollama'],
    // Cohere
    ['Cohere', 'cohere'],
    ['cohere', 'cohere'],
    // HuggingFace
    ['HuggingFace', 'huggingface'],
    ['huggingFace', 'huggingface'],
    // AWS Bedrock
    ['AwsBedrock', 'amazon-bedrock'],
    ['awsBedrock', 'amazon-bedrock'],
    ['Bedrock', 'amazon-bedrock'],
    // xAI / Grok
    ['xAi', 'xai'],
    ['XAi', 'xai'],
    // Fireworks
    ['Fireworks', 'fireworks-ai'],
    ['fireworks', 'fireworks-ai'],
    // Together AI
    ['TogetherAi', 'together-ai'],
    ['togetherAi', 'together-ai'],
    ['Together', 'together-ai'],
    // Perplexity
    ['Perplexity', 'perplexity'],
    ['perplexity', 'perplexity'],
    // Replicate
    ['Replicate', 'replicate'],
    ['replicate', 'replicate'],
    // Voyage (embeddings)
    ['VoyageAi', 'voyage'],
    ['voyageAi', 'voyage'],
];

// Model name/id patterns → original maker provider ID.
// Used to resolve the true maker regardless of which reseller lists the model.
const MODEL_MAKER_PATTERNS: [RegExp, string][] = [
    [/gpt|o[1-9]|chatgpt|davinci|curie|babbage|ada|dall-e|whisper|tts/i, 'openai'],
    [/claude/i, 'anthropic'],
    [/gemini|gemma|palm/i, 'google'],
    [/mistral|mixtral|codestral|pixtral|ministral/i, 'mistralai'],
    [/llama|llama[- ]?[0-9]/i, 'meta'],
    [/command[- ]?r|embed[- ]?v|rerank/i, 'cohere'],
    [/deepseek/i, 'deepseek'],
    [/qwen/i, 'alibaba'],
    [/phi[- ]?[0-9]/i, 'microsoft'],
    [/jamba|jurassic/i, 'ai21'],
    [/stable[- ]?diffusion|sdxl|stable[- ]?lm/i, 'stability-ai'],
    [/titan/i, 'amazon'],
    [/grok/i, 'xai'],
    [/flux/i, 'black-forest-labs'],
    [/dbrx/i, 'databricks'],
    [/nova[- ]?(pro|lite|micro|canvas|reel)/i, 'amazon'],
];

function getOriginalMaker(modelNameOrId: string): string | null {
    for (const [pattern, maker] of MODEL_MAKER_PATTERNS) {
        if (pattern.test(modelNameOrId)) return maker;
    }
    return null;
}

let lastFetchTime = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let initPromise: Promise<void> | null = null;

function normalizeModelName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9.]/g, '');
}

function getLogoUrl(providerId: string): string {
    return `https://models.dev/logos/${providerId}.svg`;
}

async function fetchAndCache(): Promise<void> {
    try {
        console.log('[models] Fetching models.dev catalog...');
        const response = await fetch('https://models.dev/api.json');
        if (!response.ok) {
            console.error(`[models] Failed to fetch: ${response.status}`);
            return;
        }

        const data: Record<string, ModelsDevProvider> = await response.json();

        modelLookup.clear();
        providerCache.clear();

        for (const [providerId, provider] of Object.entries(data)) {
            if (!provider.models) continue;

            const modelEntries = Object.entries(provider.models);
            providerCache.set(providerId, {
                id: providerId,
                name: provider.name || providerId,
                logoUrl: getLogoUrl(providerId),
                modelCount: modelEntries.length,
            });

            for (const [modelId, model] of modelEntries) {
                const match: ModelMatch = {
                    modelId,
                    modelName: model.name,
                    providerId,
                    providerName: provider.name || providerId,
                    logoUrl: getLogoUrl(providerId),
                    family: model.family,
                    reasoning: model.reasoning,
                };

                // Helper: set key preferring the original model maker.
                // If the model matches a known maker pattern, only that maker's entry wins.
                const setIfBetter = (key: string, entry: ModelMatch, refName: string) => {
                    const existing = modelLookup.get(key);
                    if (!existing) {
                        modelLookup.set(key, entry);
                        return;
                    }
                    const trueMaker = getOriginalMaker(refName);
                    if (trueMaker && entry.providerId === trueMaker && existing.providerId !== trueMaker) {
                        modelLookup.set(key, entry); // original maker takes priority
                    }
                };

                const refName = model.name || modelId;

                // Index by multiple keys for flexible matching
                setIfBetter(normalizeModelName(modelId), match, refName);
                setIfBetter(normalizeModelName(model.name), match, refName);

                // Also index by the last segment of the ID (e.g., "gpt-5" from "openai/gpt-5")
                if (modelId.includes('/')) {
                    const shortId = modelId.split('/').pop()!;
                    setIfBetter(normalizeModelName(shortId), match, refName);
                }
            }
        }

        lastFetchTime = Date.now();
        console.log(`[models] Cached ${modelLookup.size} model entries from ${providerCache.size} providers`);
    } catch (error) {
        console.error('[models] Error fetching models.dev:', error);
    }
}

export async function ensureModelsLoaded(): Promise<void> {
    if (Date.now() - lastFetchTime < CACHE_TTL_MS && modelLookup.size > 0) {
        return;
    }
    if (!initPromise) {
        initPromise = fetchAndCache().finally(() => { initPromise = null; });
    }
    return initPromise;
}

/**
 * Look up a model string from an n8n node parameter against the models.dev catalog
 */
export function lookupModel(modelParam: string): ModelMatch | null {
    if (!modelParam) return null;

    const normalized = normalizeModelName(modelParam);
    const trueMaker = getOriginalMaker(modelParam);

    // Direct match
    const direct = modelLookup.get(normalized);
    if (direct) {
        // If we know the true maker and this isn't it, check if the maker's entry exists
        if (trueMaker && direct.providerId !== trueMaker) {
            // Scan for the maker's version
            for (const [, match] of modelLookup.entries()) {
                if (match.providerId === trueMaker && normalizeModelName(match.modelName) === normalized) {
                    return match;
                }
            }
        }
        return direct;
    }

    // Partial match — collect candidates, prefer original maker
    let fallback: ModelMatch | null = null;
    for (const [key, match] of modelLookup.entries()) {
        if (key.includes(normalized) || normalized.includes(key)) {
            if (trueMaker && match.providerId === trueMaker) {
                return match; // exact maker match — use immediately
            }
            if (!fallback) fallback = match;
        }
    }

    // If we have a fallback but know the true maker, override the provider
    if (fallback && trueMaker) {
        const makerInfo = providerCache.get(trueMaker);
        return {
            ...fallback,
            providerId: trueMaker,
            providerName: makerInfo?.name || trueMaker,
            logoUrl: getLogoUrl(trueMaker),
        };
    }

    return fallback;
}

/**
 * Infer provider from n8n node type string
 */
export function inferProviderFromNodeType(nodeType: string): { id: string; name: string; logoUrl: string } | null {
    for (const [pattern, providerId] of N8N_NODE_PROVIDER_MAP) {
        if (nodeType.includes(pattern)) {
            const cached = providerCache.get(providerId);
            return {
                id: providerId,
                name: cached?.name || providerId,
                logoUrl: getLogoUrl(providerId),
            };
        }
    }
    return null;
}

/**
 * Check if an n8n node type is an AI/LLM node.
 * Covers all @n8n/n8n-nodes-langchain categories and native AI nodes.
 *
 * Langchain node type patterns:
 *   @n8n/n8n-nodes-langchain.lmChat*        - Chat model nodes (OpenAI, Anthropic, Gemini, etc.)
 *   @n8n/n8n-nodes-langchain.lm*             - Text completion / legacy LM nodes
 *   @n8n/n8n-nodes-langchain.embeddings*     - Embedding model nodes
 *   @n8n/n8n-nodes-langchain.agent           - AI Agent node
 *   @n8n/n8n-nodes-langchain.chain*          - LLM chains (chainLlm, chainSummarization, chainRetrievalQa)
 *   @n8n/n8n-nodes-langchain.outputParser*   - Output parsers that reference models
 *   @n8n/n8n-nodes-langchain.toolChat*       - Chat tool nodes
 *   @n8n/n8n-nodes-langchain.textClassifier  - Text classifier
 *   @n8n/n8n-nodes-langchain.sentimentAnalysis
 *   @n8n/n8n-nodes-langchain.informationExtractor
 *   @n8n/n8n-nodes-langchain.summarization
 *   @n8n/n8n-nodes-langchain.textSplitter*   - Not AI models, but part of AI pipeline
 *
 * Native nodes:
 *   n8n-nodes-base.openAi                   - Native OpenAI (chat, image, audio, etc.)
 */
const AI_NODE_PATTERNS = [
    // Langchain LM / Chat Model nodes
    'langchain.lmChat',
    'langchain.lm',
    // Langchain Embedding nodes
    'langchain.embeddings',
    // Langchain Agent
    'langchain.agent',
    // Langchain Chains (LLM Chain, Summarization, RetrievalQA, etc.)
    'langchain.chain',
    // Langchain Tool Chat
    'langchain.toolChat',
    // Langchain high-level AI task nodes
    'langchain.textClassifier',
    'langchain.sentimentAnalysis',
    'langchain.informationExtractor',
    'langchain.summarization',
    // Native OpenAI node
    'n8n-nodes-base.openAi',
];

export function isAINodeType(nodeType: string): boolean {
    if (!nodeType) return false;
    return AI_NODE_PATTERNS.some(pattern => nodeType.includes(pattern));
}

/**
 * Get all cached providers for the client
 */
export function getProviders(): ProviderInfo[] {
    return Array.from(providerCache.values())
        .filter(p => p.modelCount > 0)
        .sort((a, b) => b.modelCount - a.modelCount);
}

/**
 * Get the total model count
 */
export function getModelCount(): number {
    return modelLookup.size;
}
