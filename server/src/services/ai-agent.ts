// ─── Multi-Turn Agent Loop for Claude tool_use ──────────────────────────────
// Generic conversation loop that sends messages to Claude with tool definitions,
// executes tool calls via a callback, and loops until Claude produces a final text response.

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TokenUsage {
    input_tokens: number;
    output_tokens: number;
}

export interface AgentTool {
    name: string;
    description: string;
    input_schema: Record<string, any>;
}

/** Callback: given a tool name + input, return the result string */
export type ToolExecutor = (toolName: string, input: Record<string, any>) => Promise<string>;

export interface AgentLoopOptions {
    apiKey: string;
    systemPrompt: string;
    tools: AgentTool[];
    initialMessage: string;
    toolExecutor: ToolExecutor;
    maxTurns?: number;         // default 5
    maxOutputTokens?: number;  // default 4096
    timeoutMs?: number;        // per-turn timeout, default 60000
    model?: string;            // default claude-sonnet-4-20250514
}

export interface AgentResult {
    finalText: string;
    totalTokenUsage: TokenUsage;
    turns: number;
}

// ─── Internal types for Anthropic API ────────────────────────────────────────

interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
    type: string;
    [key: string]: any;
}

interface AnthropicToolUseBlock {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, any>;
}

interface AnthropicTextBlock {
    type: 'text';
    text: string;
}

interface AnthropicToolResultBlock {
    type: 'tool_result';
    tool_use_id: string;
    content: string;
}

interface AnthropicApiResponse {
    id: string;
    type: string;
    role: string;
    content: AnthropicContentBlock[];
    model: string;
    stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
}

// ─── Agent Loop ──────────────────────────────────────────────────────────────

/**
 * Run a multi-turn conversation loop with Claude using tool_use.
 *
 * Flow:
 * 1. Send initial user message with tool definitions
 * 2. If Claude responds with stop_reason === 'tool_use':
 *    - Execute each tool call via toolExecutor
 *    - Append assistant response + tool_result messages
 *    - Continue loop
 * 3. If Claude responds with stop_reason !== 'tool_use' (text response):
 *    - This is the final response — extract text and return
 * 4. Accumulate token usage across all turns
 * 5. Abort after maxTurns with whatever text we have
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentResult> {
    const {
        apiKey,
        systemPrompt,
        tools,
        initialMessage,
        toolExecutor,
        maxTurns = 5,
        maxOutputTokens = 4096,
        timeoutMs = 60000,
        model = 'claude-sonnet-4-20250514',
    } = options;

    const totalUsage: TokenUsage = { input_tokens: 0, output_tokens: 0 };
    const messages: AnthropicMessage[] = [
        { role: 'user', content: initialMessage },
    ];

    let turns = 0;
    let finalText = '';

    while (turns < maxTurns) {
        turns++;

        // Call Anthropic API
        const response = await callAnthropic({
            apiKey,
            model,
            systemPrompt,
            messages,
            tools,
            maxOutputTokens,
            timeoutMs,
        });

        // Accumulate tokens
        totalUsage.input_tokens += response.usage.input_tokens;
        totalUsage.output_tokens += response.usage.output_tokens;

        // Append assistant response to conversation history
        messages.push({
            role: 'assistant',
            content: response.content,
        });

        // Check if Claude wants to use tools
        if (response.stop_reason === 'tool_use') {
            // Extract all tool_use blocks
            const toolUseBlocks = response.content.filter(
                (block): block is AnthropicToolUseBlock => block.type === 'tool_use'
            );

            // Log tools called this turn
            const toolNames = toolUseBlocks.map(b => b.name).join(', ');
            console.log(`[agent] Turn ${turns}/${maxTurns}: tool_use → ${toolNames}`);

            if (toolUseBlocks.length === 0) {
                // Shouldn't happen with stop_reason === 'tool_use', but handle gracefully
                finalText = extractText(response.content);
                break;
            }

            // Execute each tool call and collect results
            const toolResults: AnthropicToolResultBlock[] = [];
            for (const toolBlock of toolUseBlocks) {
                let resultContent: string;
                try {
                    resultContent = await toolExecutor(toolBlock.name, toolBlock.input);
                } catch (err: any) {
                    resultContent = JSON.stringify({
                        error: true,
                        message: err.message || 'Tool execution failed',
                    });
                }

                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: toolBlock.id,
                    content: resultContent,
                });
            }

            // Append tool results as a user message
            messages.push({
                role: 'user',
                content: toolResults as any,
            });

            // Continue the loop — Claude will process tool results
            continue;
        }

        // Not a tool_use response — this is the final text response
        finalText = extractText(response.content);
        console.log(`[agent] Turn ${turns}/${maxTurns}: final text response (${finalText.length} chars)`);
        break;
    }

    // If we exhausted maxTurns without a final text response, collect ALL text blocks from assistant messages
    if (!finalText && messages.length > 0) {
        const allAssistantText = messages
            .filter(m => m.role === 'assistant' && Array.isArray(m.content))
            .map(m => extractText(m.content as AnthropicContentBlock[]))
            .filter(t => t.length > 0)
            .join('\n');
        finalText = allAssistantText;
        if (!finalText) {
            console.warn(`[agent] Exhausted ${maxTurns} turns with no text response from Claude`);
        }
    }

    return {
        finalText,
        totalTokenUsage: totalUsage,
        turns,
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract concatenated text from content blocks */
function extractText(content: AnthropicContentBlock[]): string {
    return content
        .filter((block): block is AnthropicTextBlock => block.type === 'text')
        .map(block => block.text)
        .join('\n');
}

/** Make a single call to the Anthropic Messages API */
async function callAnthropic(opts: {
    apiKey: string;
    model: string;
    systemPrompt: string;
    messages: AnthropicMessage[];
    tools: AgentTool[];
    maxOutputTokens: number;
    timeoutMs: number;
}): Promise<AnthropicApiResponse> {
    const body: Record<string, any> = {
        model: opts.model,
        max_tokens: opts.maxOutputTokens,
        system: opts.systemPrompt,
        messages: opts.messages,
    };

    // Only include tools if there are any defined
    if (opts.tools.length > 0) {
        body.tools = opts.tools;
    }

    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': opts.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs),
    });

    if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        throw new Error(`Anthropic API error (${res.status}): ${errorBody}`);
    }

    return res.json() as Promise<AnthropicApiResponse>;
}
