import { URL } from 'url';
import { isAINodeType, lookupModel, inferProviderFromNodeType } from './models';

interface ResourceData {
    type: string;
    identifier: string;
    provider?: string;
    node_name?: string;
    logo_url?: string;
    credential_name?: string;
    credential_id?: string;
    credential_exposed?: boolean;
}

interface TokenUsageData {
    model: string;
    provider: string;
    tokens_input: number;
    tokens_output: number;
    accuracy: string;
}

// Helpers
function isExpression(value: any): boolean {
    if (!value) return false;
    // RL objects (Resource Locators) are not expressions in the traditional string sense
    if (typeof value === 'object' && value.__rl) return false;
    if (typeof value !== 'string') return false;
    // n8n expressions use ={{ }} syntax or start with = for simple references
    // Do NOT match plain '=' (query params) or '$' (valid in URLs)
    if (value.includes('{{') && value.includes('}}')) return true;
    if (value.startsWith('={{')) return true;
    if (value.startsWith('=') && value.includes('$')) return true;
    return false;
}

function cleanValue(value: any): any {
    if (!value) return null;
    if (typeof value === 'object' && value.__rl && value.value) {
        return value.value;
    }
    return value;
}

function isAINode(node: any): boolean {
    return isAINodeType(node.type || '');
}

function extractModelFromNode(node: any): { name: string; provider: string; logoUrl?: string; subtype?: string } | null {
    // Different n8n AI nodes store the model name under different parameter paths:
    //   lmChatOpenAi, lmChatAnthropic, etc. → parameters.model
    //   lmChatAzureOpenAi                   → parameters.model or parameters.deploymentName
    //   embeddingsOpenAi, embeddingsMistral  → parameters.model or parameters.modelId
    //   native openAi node                  → parameters.modelId or parameters.model
    //   agent node                          → model is on connected sub-node, not here
    //   chainLlm, chainSummarization        → model is on connected sub-node
    //   lmChatHuggingFaceInference          → parameters.model or parameters.modelId
    //   lmChatOllama                        → parameters.model (local model name)
    //   lmChatAwsBedrock                    → parameters.model (ARN or model ID)
    //   options.model                       → some nodes nest it under options
    const paramPaths = [
        node.parameters?.model,
        node.parameters?.modelId,
        node.parameters?.modelName,
        node.parameters?.deploymentName,
        node.parameters?.options?.model,
        node.parameters?.options?.modelName,
        node.parameters?.options?.modelId,
    ];

    let modelParam: string | null = null;
    for (const raw of paramPaths) {
        const cleaned = cleanValue(raw);
        if (cleaned && !isExpression(cleaned)) {
            modelParam = typeof cleaned === 'string' ? cleaned : String(cleaned);
            break;
        }
    }

    if (!modelParam) return null;

    // Determine subtype from node type
    let subtype = 'llm';
    const nodeType = node.type || '';
    if (nodeType.includes('embeddings')) subtype = 'embedding';
    else if (nodeType.includes('chain')) subtype = 'chain';
    else if (nodeType.includes('agent')) subtype = 'agent';

    // Try to match against models.dev catalog
    const match = lookupModel(modelParam);
    if (match) {
        return {
            name: match.modelName,
            provider: match.providerId,
            logoUrl: match.logoUrl,
            subtype,
        };
    }

    // Fall back to inferring provider from n8n node type
    const providerInfo = inferProviderFromNodeType(nodeType);
    return {
        name: modelParam,
        provider: providerInfo?.id || 'unknown',
        logoUrl: providerInfo?.logoUrl,
        subtype,
    };
}

// Clean n8n credential type key → readable provider name
// e.g. "openAiApi" → "openai", "anthropicApi" → "anthropic", "googleSheetsOAuth2Api" → "google"
function cleanCredentialType(credType: string): string {
    const lower = credType.toLowerCase();
    if (lower.includes('openai')) return 'openai';
    if (lower.includes('anthropic')) return 'anthropic';
    if (lower.includes('google')) return 'google';
    if (lower.includes('microsoft') || lower.includes('outlook') || lower.includes('onedrive')) return 'microsoft';
    if (lower.includes('azure')) return 'azure';
    if (lower.includes('aws') || lower.includes('bedrock')) return 'aws';
    if (lower.includes('huggingface') || lower.includes('hugging')) return 'huggingface';
    if (lower.includes('ollama')) return 'ollama';
    if (lower.includes('mistral')) return 'mistral';
    if (lower.includes('cohere')) return 'cohere';
    if (lower.includes('slack')) return 'slack';
    if (lower.includes('notion')) return 'notion';
    if (lower.includes('airtable')) return 'airtable';
    if (lower.includes('postgres')) return 'postgres';
    if (lower.includes('mysql')) return 'mysql';
    if (lower.includes('mongo')) return 'mongodb';
    if (lower.includes('redis')) return 'redis';
    if (lower.includes('stripe')) return 'stripe';
    if (lower.includes('twilio')) return 'twilio';
    if (lower.includes('sendgrid')) return 'sendgrid';
    if (lower.includes('mailchimp')) return 'mailchimp';
    if (lower.includes('github')) return 'github';
    if (lower.includes('gitlab')) return 'gitlab';
    if (lower.includes('jira')) return 'jira';
    if (lower.includes('discord')) return 'discord';
    if (lower.includes('telegram')) return 'telegram';
    if (lower.includes('shopify')) return 'shopify';
    if (lower.includes('hubspot')) return 'hubspot';
    if (lower.includes('salesforce')) return 'salesforce';
    if (lower.includes('supabase')) return 'supabase';
    if (lower.includes('firebase')) return 'firebase';
    // Fallback: strip trailing "Api", "OAuth2Api", etc. and lowercase
    return credType
        .replace(/OAuth2Api$/i, '')
        .replace(/Api$/i, '')
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .toLowerCase();
}

function extractDomain(url: any): string | null {
    try {
        const hostname = new URL(url).hostname;
        return hostname;
    } catch (e) { return null; }
}

function isInternalDomain(domain: string): boolean {
    return domain === 'localhost' || domain === '127.0.0.1';
}

// Google API URL patterns for detecting Docs/Sheets/Slides/Drive via HTTP Request nodes
// Docs:   https://docs.googleapis.com/v1/documents/{documentId}
// Sheets: https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}
// Slides: https://slides.googleapis.com/v1/presentations/{presentationId}
// Drive:  https://www.googleapis.com/drive/v3/files/{fileId}
// Alt:    https://content-docs.googleapis.com/..., https://content-sheets.googleapis.com/...
const GOOGLE_API_PATTERNS: { regex: RegExp; type: string }[] = [
    { regex: /docs\.googleapis\.com\/v1\/documents\/([a-zA-Z0-9_-]+)/, type: 'google_doc' },
    { regex: /content-docs\.googleapis\.com\/.*\/documents\/([a-zA-Z0-9_-]+)/, type: 'google_doc' },
    { regex: /sheets\.googleapis\.com\/v4\/spreadsheets\/([a-zA-Z0-9_-]+)/, type: 'google_sheet' },
    { regex: /content-sheets\.googleapis\.com\/.*\/spreadsheets\/([a-zA-Z0-9_-]+)/, type: 'google_sheet' },
    { regex: /slides\.googleapis\.com\/v1\/presentations\/([a-zA-Z0-9_-]+)/, type: 'google_slide' },
    { regex: /www\.googleapis\.com\/drive\/v[23]\/files\/([a-zA-Z0-9_-]+)/, type: 'google_drive' },
];

function extractGoogleResourceFromUrl(url: string): { type: string; id: string } | null {
    for (const pattern of GOOGLE_API_PATTERNS) {
        const match = url.match(pattern.regex);
        if (match && match[1]) {
            return { type: pattern.type, id: match[1] };
        }
    }
    // Also check for Google Docs/Sheets direct URLs (not API, but browser URLs sometimes hardcoded)
    // https://docs.google.com/document/d/{id}/...
    // https://docs.google.com/spreadsheets/d/{id}/...
    // https://docs.google.com/presentation/d/{id}/...
    const docsMatch = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (docsMatch) return { type: 'google_doc', id: docsMatch[1] };

    const sheetsMatch = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (sheetsMatch) return { type: 'google_sheet', id: sheetsMatch[1] };

    const slidesMatch = url.match(/docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/);
    if (slidesMatch) return { type: 'google_slide', id: slidesMatch[1] };

    return null;
}


// Detect hardcoded authentication in HTTP Request node parameters
// Checks headers, query params, and body params for auth-related key names
// Uses substring matching so keys like auth_type, api_key_header, password_field all match
const AUTH_SUBSTRINGS = [
    'auth',          // authorization, auth_type, auth_token, x-auth, oauth
    'api_key', 'api-key', 'apikey',
    'api_secret', 'api-secret', 'apisecret',
    'api_token', 'api-token', 'apitoken',
    'password', 'passwd',
    'secret',
    'token',         // access_token, refresh_token, session_token, bearer_token
    'bearer',
    'credential',
    'private_key', 'private-key', 'privatekey',
    'client_id', 'client-id', 'clientid',
    'client_secret', 'client-secret', 'clientsecret',
    'access_key', 'access-key', 'accesskey',
    'session_key', 'session-key', 'sessionkey',
    'signing_key', 'signing-key',
];

function isAuthKey(name: string): boolean {
    const lower = name.toLowerCase().trim();
    return AUTH_SUBSTRINGS.some(sub => lower.includes(sub));
}

// Check key-value parameter arrays for auth keys with hardcoded values
function scanParamArrays(arrays: any[]): boolean {
    for (const arr of arrays) {
        if (!Array.isArray(arr)) continue;
        for (const param of arr) {
            const name = param?.name;
            if (!name || typeof name !== 'string' || isExpression(name)) continue;
            if (isAuthKey(name)) {
                const value = param?.value;
                if (value && typeof value === 'string' && !isExpression(value) && value.length > 0) {
                    return true;
                }
            }
        }
    }
    return false;
}

// Recursively scan a JSON object for auth-related keys with static string values
function scanJsonForAuth(obj: any, depth = 0): boolean {
    if (depth > 5 || !obj || typeof obj !== 'object') return false;
    for (const [key, val] of Object.entries(obj)) {
        if (isAuthKey(key)) {
            if (typeof val === 'string' && !isExpression(val) && val.length > 0) return true;
        }
        if (typeof val === 'object' && val !== null) {
            if (scanJsonForAuth(val, depth + 1)) return true;
        }
    }
    return false;
}

function hasExposedCredentials(node: any): boolean {
    if (node.type !== 'n8n-nodes-base.httpRequest') return false;
    const params = node.parameters;
    if (!params) return false;

    // Collect all key-value parameter arrays (don't gate on sendHeaders/sendBody/sendQuery flags)
    const paramArrays: any[] = [];
    if (params.headerParameters?.parameters) paramArrays.push(params.headerParameters.parameters);
    if (params.options?.headers?.parameters) paramArrays.push(params.options.headers.parameters);
    if (params.queryParameters?.parameters) paramArrays.push(params.queryParameters.parameters);
    if (params.bodyParameters?.parameters) paramArrays.push(params.bodyParameters.parameters);
    if (params.options?.bodyParameters?.parameters) paramArrays.push(params.options.bodyParameters.parameters);

    if (scanParamArrays(paramArrays)) return true;

    // Scan raw JSON body (jsonBody field — any body content type)
    for (const bodyField of [params.jsonBody, params.body]) {
        if (bodyField && typeof bodyField === 'string' && !isExpression(bodyField)) {
            try {
                const parsed = JSON.parse(bodyField);
                if (scanJsonForAuth(parsed)) return true;
            } catch { /* not valid JSON, skip */ }
        }
    }

    // Scan the entire options object for nested auth keys
    if (params.options && typeof params.options === 'object') {
        if (scanJsonForAuth(params.options)) return true;
    }

    return false;
}

// Extract first credential from a node (most nodes have exactly one)
function getNodeCredential(node: any): { name: string; id: string; type: string } | null {
    if (!node.credentials || typeof node.credentials !== 'object') return null;
    const entries = Object.entries(node.credentials);
    if (entries.length === 0) return null;
    const [credType, credValue] = entries[0];
    const cred = credValue as any;
    if (cred?.id && cred?.name) {
        return { name: cred.name, id: cred.id, type: credType };
    }
    return null;
}

export const extractResources = (workflow: any): ResourceData[] => {
    const resources: ResourceData[] = [];

    if (!workflow.nodes || !Array.isArray(workflow.nodes)) return resources;

    for (const node of workflow.nodes) {
        const cred = getNodeCredential(node);

        // AI Models
        if (isAINode(node)) {
            const model = extractModelFromNode(node);
            if (model) {
                resources.push({
                    type: model.subtype === 'embedding' ? 'ai_embedding' : 'ai_model',
                    identifier: model.name,
                    provider: model.provider,
                    node_name: node.name,
                    logo_url: model.logoUrl,
                    credential_name: cred?.name,
                    credential_id: cred?.id,
                });
            }
        }

        // Google Docs/Sheets
        if (node.type === 'n8n-nodes-base.googleDocs' ||
            node.type === 'n8n-nodes-base.googleSheets') {
            const docIdRaw = node.parameters?.documentId || node.parameters?.spreadsheetId;
            const docId = cleanValue(docIdRaw);

            if (docId && !isExpression(docId)) {
                resources.push({
                    type: node.type.includes('Sheets') ? 'google_sheet' : 'google_doc',
                    identifier: docId,
                    provider: 'google',
                    node_name: node.name,
                    credential_name: cred?.name,
                    credential_id: cred?.id,
                });
            }
        }

        // Google Drive (files, folders, shared drives)
        if (node.type === 'n8n-nodes-base.googleDrive') {
            // Extract all possible IDs from the node parameters
            const idCandidates = [
                { raw: node.parameters?.fileId, label: 'file' },
                { raw: node.parameters?.folderId, label: 'folder' },
                { raw: node.parameters?.driveId, label: 'drive' },
            ];
            for (const { raw } of idCandidates) {
                const id = cleanValue(raw?.value ?? raw);
                if (id && !isExpression(id)) {
                    resources.push({
                        type: 'google_drive',
                        identifier: id,
                        provider: 'google',
                        node_name: node.name,
                        credential_name: cred?.name,
                        credential_id: cred?.id,
                    });
                }
            }
        }

        // Google Slides
        if (node.type === 'n8n-nodes-base.googleSlides') {
            const presIdRaw = node.parameters?.presentationId;
            const presId = cleanValue(presIdRaw?.value ?? presIdRaw);
            if (presId && !isExpression(presId)) {
                resources.push({
                    type: 'google_slide',
                    identifier: presId,
                    provider: 'google',
                    node_name: node.name,
                    credential_name: cred?.name,
                    credential_id: cred?.id,
                });
            }
        }

        // Databases & Vector Stores
        const DB_NODE_MAP: Record<string, string> = {
            'n8n-nodes-base.postgres': 'postgres',
            'n8n-nodes-base.crateDb': 'cratedb',
            'n8n-nodes-base.questDb': 'questdb',
            'n8n-nodes-base.timescaleDb': 'timescaledb',
            'n8n-nodes-base.cockroachDb': 'cockroachdb',
            'n8n-nodes-base.mySql': 'mysql',
            'n8n-nodes-base.mariaDb': 'mariadb',
            'n8n-nodes-base.mongoDb': 'mongodb',
            'n8n-nodes-base.redis': 'redis',
            'n8n-nodes-base.microsoftSql': 'mssql',
            'n8n-nodes-base.snowflake': 'snowflake',
            'n8n-nodes-base.elasticsearch': 'elasticsearch',
            '@n8n/n8n-nodes-langchain.vectorStoreQdrant': 'qdrant',
            '@n8n/n8n-nodes-langchain.vectorStorePinecone': 'pinecone',
            '@n8n/n8n-nodes-langchain.vectorStoreWeaviate': 'weaviate',
            '@n8n/n8n-nodes-langchain.vectorStoreChroma': 'chroma',
            '@n8n/n8n-nodes-langchain.vectorStoreMilvus': 'milvus',
            '@n8n/n8n-nodes-langchain.vectorStoreSupabase': 'supabase',
            '@n8n/n8n-nodes-langchain.vectorStorePGVector': 'pgvector',
            '@n8n/n8n-nodes-langchain.vectorStoreZep': 'zep',
            'n8n-nodes-base.supabase': 'supabase',
            'n8n-nodes-base.airtable': 'airtable',
            'n8n-nodes-base.dynamoDb': 'dynamodb',
            'n8n-nodes-base.firebase': 'firebase',
            'n8n-nodes-base.firebaseRealtimeDatabase': 'firebase',
        };
        const dbProvider = DB_NODE_MAP[node.type];
        if (dbProvider) {
            // Try to extract a meaningful identifier: host, table, collection, or credential name
            const dbHost = cleanValue(node.parameters?.host) || cleanValue(node.parameters?.connectionString);
            const dbTable = cleanValue(node.parameters?.table) || cleanValue(node.parameters?.collection);
            const dbId = (dbHost && !isExpression(dbHost) ? dbHost : null)
                || (dbTable && !isExpression(dbTable) ? dbTable : null)
                || cred?.name
                || node.name;
            resources.push({
                type: 'database',
                identifier: dbId,
                provider: dbProvider,
                node_name: node.name,
                credential_name: cred?.name,
                credential_id: cred?.id,
            });
        }

        // Gmail
        if (node.type === 'n8n-nodes-base.gmail' ||
            node.type === 'n8n-nodes-base.googleGmail') {
            // Gmail nodes don't have a static asset ID — use the credential name as identifier
            // so users can see which Gmail account each workflow uses
            const gmailId = cred?.name || node.name;
            resources.push({
                type: 'gmail',
                identifier: gmailId,
                provider: 'google',
                node_name: node.name,
                credential_name: cred?.name,
                credential_id: cred?.id,
            });
        }

        // Webhooks & Chat Triggers (public-facing endpoints)
        if (node.type === 'n8n-nodes-base.webhook' ||
            node.type === 'n8n-nodes-base.formTrigger') {
            const path = cleanValue(node.parameters?.path);
            const webhookId = (path && !isExpression(path)) ? path : node.name;
            resources.push({
                type: 'webhook',
                identifier: webhookId,
                provider: node.type.includes('form') ? 'form' : 'webhook',
                node_name: node.name,
                credential_name: cred?.name,
                credential_id: cred?.id,
            });
        }

        // Chat/Messaging platforms
        const MESSAGING_NODE_MAP: Record<string, string> = {
            'n8n-nodes-base.slack': 'slack',
            'n8n-nodes-base.slackTrigger': 'slack',
            'n8n-nodes-base.discord': 'discord',
            'n8n-nodes-base.discordTrigger': 'discord',
            'n8n-nodes-base.telegram': 'telegram',
            'n8n-nodes-base.telegramTrigger': 'telegram',
            'n8n-nodes-base.microsoftTeams': 'microsoft_teams',
            'n8n-nodes-base.microsoftTeamsTrigger': 'microsoft_teams',
            'n8n-nodes-base.whatsApp': 'whatsapp',
            'n8n-nodes-base.whatsAppTrigger': 'whatsapp',
            '@n8n/n8n-nodes-langchain.chatTrigger': 'chat',
        };
        const msgProvider = MESSAGING_NODE_MAP[node.type];
        if (msgProvider) {
            const channel = cleanValue(node.parameters?.channel || node.parameters?.chatId);
            const msgId = (channel && !isExpression(channel)) ? channel : cred?.name || node.name;
            resources.push({
                type: 'messaging',
                identifier: msgId,
                provider: msgProvider,
                node_name: node.name,
                credential_name: cred?.name,
                credential_id: cred?.id,
            });
        }

        // Calendar
        const CALENDAR_NODE_MAP: Record<string, string> = {
            'n8n-nodes-base.googleCalendar': 'google',
            'n8n-nodes-base.googleCalendarTrigger': 'google',
            'n8n-nodes-base.microsoftOutlook': 'microsoft',
            'n8n-nodes-base.microsoftOutlookTrigger': 'microsoft',
            'n8n-nodes-base.iCal': 'ical',
            'n8n-nodes-base.calendly': 'calendly',
            'n8n-nodes-base.calendlyTrigger': 'calendly',
        };
        const calProvider = CALENDAR_NODE_MAP[node.type];
        if (calProvider) {
            const calId = cleanValue(node.parameters?.calendarId);
            const calIdentifier = (calId && !isExpression(calId)) ? calId : cred?.name || node.name;
            resources.push({
                type: 'calendar',
                identifier: calIdentifier,
                provider: calProvider,
                node_name: node.name,
                credential_name: cred?.name,
                credential_id: cred?.id,
            });
        }

        // Social Media
        const SOCIAL_NODE_MAP: Record<string, string> = {
            'n8n-nodes-base.twitter': 'twitter',
            'n8n-nodes-base.twitterTrigger': 'twitter',
            'n8n-nodes-base.linkedIn': 'linkedin',
            'n8n-nodes-base.facebookGraphApi': 'facebook',
            'n8n-nodes-base.facebookTrigger': 'facebook',
            'n8n-nodes-base.instagram': 'instagram',
            'n8n-nodes-base.redditTrigger': 'reddit',
            'n8n-nodes-base.reddit': 'reddit',
            'n8n-nodes-base.youTube': 'youtube',
            'n8n-nodes-base.tiktok': 'tiktok',
        };
        const socialProvider = SOCIAL_NODE_MAP[node.type];
        if (socialProvider) {
            const socialId = cred?.name || node.name;
            resources.push({
                type: 'social',
                identifier: socialId,
                provider: socialProvider,
                node_name: node.name,
                credential_name: cred?.name,
                credential_id: cred?.id,
            });
        }

        // Standalone credential entries (for dedicated Credentials tab)
        if (node.credentials && typeof node.credentials === 'object') {
            for (const [credType, credValue] of Object.entries(node.credentials)) {
                const c = credValue as any;
                if (c?.id && c?.name) {
                    resources.push({
                        type: 'credential',
                        identifier: c.id,
                        provider: cleanCredentialType(credType),
                        node_name: c.name,
                    });
                }
            }
        }

        // HTTP Request (external APIs + Google Docs/Sheets/Slides/Drive detection)
        if (node.type === 'n8n-nodes-base.httpRequest') {
            const urlRaw = node.parameters?.url;
            const url = cleanValue(urlRaw);
            const exposed = hasExposedCredentials(node);

            if (url && !isExpression(url)) {
                // Check if this is a Google Docs/Sheets/Slides/Drive API call
                const googleResource = extractGoogleResourceFromUrl(url);
                if (googleResource) {
                    resources.push({
                        type: googleResource.type,
                        identifier: googleResource.id,
                        provider: 'google',
                        node_name: node.name,
                        credential_name: cred?.name,
                        credential_id: cred?.id,
                        credential_exposed: exposed,
                    });
                }

                // Always also extract the domain as an api_domain resource
                const domain = extractDomain(url);
                if (domain && !isInternalDomain(domain)) {
                    resources.push({
                        type: 'api_domain',
                        identifier: domain,
                        node_name: node.name,
                        credential_name: cred?.name,
                        credential_id: cred?.id,
                        credential_exposed: exposed,
                    });
                }
            }
        }
    }

    return resources;
};

// Resolve provider from model name using models.dev catalog, with format-based fallback
function resolveProvider(modelName: string, formatHint: string): string {
    if (!modelName || modelName === 'unknown') return formatHint;
    const match = lookupModel(modelName);
    if (match) return match.providerId;
    return formatHint;
}

// Extract token usage from a single output item's JSON
function extractTokensFromJson(json: any): TokenUsageData | null {
    if (!json) return null;

    // OpenAI format: { usage: { prompt_tokens, completion_tokens } }
    if (json.usage?.prompt_tokens != null) {
        const model = json.model || 'unknown';
        return {
            model,
            provider: resolveProvider(model, 'openai'),
            tokens_input: json.usage.prompt_tokens || 0,
            tokens_output: json.usage.completion_tokens || 0,
            accuracy: 'exact'
        };
    }

    // Anthropic format: { usage: { input_tokens, output_tokens } }
    if (json.usage?.input_tokens != null) {
        const model = json.model || 'unknown';
        return {
            model,
            provider: resolveProvider(model, 'anthropic'),
            tokens_input: json.usage.input_tokens || 0,
            tokens_output: json.usage.output_tokens || 0,
            accuracy: 'exact'
        };
    }

    // Google Gemini format: { usageMetadata: { promptTokenCount, candidatesTokenCount } }
    if (json.usageMetadata?.promptTokenCount != null) {
        const model = json.modelVersion || json.model || 'unknown';
        return {
            model,
            provider: resolveProvider(model, 'google'),
            tokens_input: json.usageMetadata.promptTokenCount || 0,
            tokens_output: json.usageMetadata.candidatesTokenCount || 0,
            accuracy: 'exact'
        };
    }

    // Langchain response metadata: { response_metadata: { tokenUsage: {...} } }
    const respMeta = json.response_metadata?.tokenUsage;
    if (respMeta?.promptTokens != null) {
        const model = json.response_metadata?.model || json.model || 'unknown';
        return {
            model,
            provider: resolveProvider(model, 'unknown'),
            tokens_input: respMeta.promptTokens || 0,
            tokens_output: respMeta.completionTokens || 0,
            accuracy: 'exact'
        };
    }

    // Langchain generic: { tokenUsage: { promptTokens, completionTokens } }
    if (json.tokenUsage?.promptTokens != null) {
        const model = json.model || 'unknown';
        return {
            model,
            provider: resolveProvider(model, 'unknown'),
            tokens_input: json.tokenUsage.promptTokens || 0,
            tokens_output: json.tokenUsage.completionTokens || 0,
            accuracy: 'exact'
        };
    }

    return null;
}

export const extractTokenUsage = (execution: any): TokenUsageData[] => {
    const tokenUsage: TokenUsageData[] = [];
    const executionData = execution.data?.resultData?.runData;

    if (!executionData) return tokenUsage;

    for (const [nodeName, nodeRuns] of Object.entries(executionData)) {
        if (!Array.isArray(nodeRuns)) continue;

        for (const run of nodeRuns as any[]) {
            try {
                // Check all output branches (main[0], main[1], etc.)
                const outputs = run.data?.main;
                if (!Array.isArray(outputs)) continue;

                for (const outputItems of outputs) {
                    if (!Array.isArray(outputItems)) continue;

                    // Check all items in each output branch
                    for (const item of outputItems) {
                        const result = extractTokensFromJson(item?.json);
                        if (result) {
                            tokenUsage.push(result);
                        }
                    }
                }
            } catch (e) {
                // Ignore parsing errors for individual runs
            }
        }
    }

    return tokenUsage;
};
