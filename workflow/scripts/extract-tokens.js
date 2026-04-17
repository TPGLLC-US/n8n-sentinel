const INPUT_KEYS = [
  'prompt_tokens', 'input_tokens', 'promptTokens', 'promptTokenCount',
  'input_token_count', 'inputTokens'
];
const OUTPUT_KEYS = [
  'completion_tokens', 'output_tokens', 'completionTokens', 'candidatesTokenCount',
  'output_token_count', 'outputTokens'
];
const MODEL_KEYS = ['model_name', 'model', 'modelId', 'model_id', 'modelName'];

const NODE_TYPE_TO_PROVIDER = {
  'lmChatAnthropic': 'anthropic',
  'lmChatOpenAi': 'openai',
  'lmChatAzureOpenAi': 'azure_openai',
  'lmChatAwsBedrock': 'aws_bedrock',
  'lmChatCohere': 'cohere',
  'lmChatDeepSeek': 'deepseek',
  'lmChatGoogleGemini': 'google',
  'lmChatGoogleVertex': 'google_vertex',
  'lmChatGroq': 'groq',
  'lmChatMistralCloud': 'mistral',
  'lmChatOpenRouter': 'openrouter',
  'lmChatVercelAiGateway': 'vercel_gateway',
  'lmChatXAiGrok': 'xai',
  'lmChatLemonade': 'lemonade',
  'lmChatOllama': 'ollama',
  'lmChatAlibabaCloud': 'alibaba',
  'lmOpenAi': 'openai',
  'lmCohere': 'cohere',
  'lmOllama': 'ollama',
  'lmLemonade': 'lemonade',
  'lmOpenHuggingFaceInference': 'huggingface',
  'openAi': 'openai',
  'anthropic': 'anthropic',
  'googleGemini': 'google',
  'ollama': 'ollama',
  'openAiAssistant': 'openai',
  'mistralAi': 'mistral',
};

function providerFallback(shortType) {
  let cleaned = shortType.replace(/^(lmChat|lm|embeddingsChat|embeddings)/i, '');
  if (!cleaned || cleaned === shortType) return null;
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
}

function providerFromModel(modelName) {
  if (!modelName) return null;
  const m = modelName.toLowerCase();
  if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'openai';
  if (m.startsWith('claude-')) return 'anthropic';
  if (m.startsWith('gemini')) return 'google';
  if (m.includes('llama') || m.includes('groq')) return 'groq';
  if (m.startsWith('mistral') || m.startsWith('mixtral')) return 'mistral';
  if (m.includes('deepseek')) return 'deepseek';
  if (m.includes('command')) return 'cohere';
  if (m.includes('qwen')) return 'alibaba';
  return null;
}

function getProviderFromNodeType(nodeType) {
  const shortType = (nodeType || '').split('.').pop() || '';
  return NODE_TYPE_TO_PROVIDER[shortType] || providerFallback(shortType) || null;
}

function buildNodeMap(workflowData) {
  const map = {};
  if (!workflowData?.nodes) return map;
  for (const node of workflowData.nodes) {
    const provider = getProviderFromNodeType(node.type);
    if (provider) {
      map[node.name] = { provider, type: node.type };
    }
  }
  return map;
}

function findModelTargeted(nodeData) {
  let model = null;
  const walk = (obj, depth) => {
    if (depth > 30 || !obj || typeof obj !== 'object' || model) return;
    if (!Array.isArray(obj)) {
      if (obj.generationInfo) {
        for (const key of MODEL_KEYS) {
          if (obj.generationInfo[key] && typeof obj.generationInfo[key] === 'string'
              && !/^\d+$/.test(obj.generationInfo[key])) {
            model = obj.generationInfo[key];
            return;
          }
        }
      }
      if (obj.tokenUsage || obj.token_usage || obj.usage) {
        for (const key of MODEL_KEYS) {
          if (obj[key] && typeof obj[key] === 'string' && !/^\d+$/.test(obj[key])) {
            model = obj[key];
            return;
          }
        }
      }
      if (obj.type === 'message' || obj.stop_reason) {
        for (const key of MODEL_KEYS) {
          if (obj[key] && typeof obj[key] === 'string' && !/^\d+$/.test(obj[key])) {
            model = obj[key];
            return;
          }
        }
      }
    }
    const entries = Array.isArray(obj) ? obj : Object.values(obj);
    for (const val of entries) {
      if (val && typeof val === 'object') walk(val, depth + 1);
      if (model) return;
    }
  };
  walk(nodeData, 0);
  return model;
}

function findUsageObjects(obj, results = [], depth = 0) {
  if (depth > 50 || obj === null || typeof obj !== 'object') return results;
  if (!Array.isArray(obj)) {
    const keys = Object.keys(obj);
    const inputKey = INPUT_KEYS.find(k => keys.includes(k));
    const outputKey = OUTPUT_KEYS.find(k => keys.includes(k));
    if (inputKey || outputKey) {
      results.push({
        tokens_input: Number(obj[inputKey]) || 0,
        tokens_output: Number(obj[outputKey]) || 0,
      });
    }
  }
  const entries = Array.isArray(obj) ? obj : Object.values(obj);
  for (const val of entries) {
    if (val && typeof val === 'object') findUsageObjects(val, results, depth + 1);
  }
  return results;
}

function dedupeUsage(usages) {
  const seen = new Set();
  return usages.filter(u => {
    const key = `${u.tokens_input}:${u.tokens_output}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const items = $input.all();
const results = [];

for (const item of items) {
  const exec = item.json;
  const execId = exec.id;
  const workflowId = exec.workflowId;
  const runData = exec.data?.resultData?.runData || {};
  const nodeMap = buildNodeMap(exec.workflowData);

  let allUsages = [];
  let model = 'unknown';
  let provider = 'unknown';

  for (const [nodeName, runs] of Object.entries(runData)) {
    const usages = findUsageObjects(runs);
    if (usages.length > 0) {
      allUsages.push(...usages);
      if (model === 'unknown') {
        model = findModelTargeted(runs) || 'unknown';
      }
      if (provider === 'unknown' && nodeMap[nodeName]) {
        provider = nodeMap[nodeName].provider;
      }
    }
  }

  if (provider === 'unknown') {
    for (const [name, info] of Object.entries(nodeMap)) {
      if (info.type && (info.type.includes('lmChat') || info.type.includes('lm'))) {
        provider = info.provider;
        break;
      }
    }
  }

  if (provider === 'unknown' && model !== 'unknown') {
    provider = providerFromModel(model) || 'unknown';
  }

  allUsages = dedupeUsage(allUsages);

  results.push({
    json: {
      execution_id: execId,
      workflow_id: workflowId,
      model: allUsages.length > 0 ? model : null,
      provider: allUsages.length > 0 ? provider : null,
      tokens_input: allUsages.reduce((sum, u) => sum + u.tokens_input, 0),
      tokens_output: allUsages.reduce((sum, u) => sum + u.tokens_output, 0),
      usage_count: allUsages.length,
    }
  });
}

return results;
