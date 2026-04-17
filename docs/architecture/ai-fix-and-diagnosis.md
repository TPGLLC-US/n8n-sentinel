# AI Fix & Diagnosis

**Purpose.** Use Claude to diagnose failed n8n executions and, optionally, apply a fix back to the user's n8n instance. Two diagnosis modes (simple single-shot, and complex agentic multi-turn) plus an agentic fix pipeline with its own tool set.

**Entry points.**
- `POST /api/errors/:id/diagnose` — `server/src/routes/errors.ts:223`. Body `{ mode: 'simple'|'complex', force?: boolean }` — defaults to simple. Rate-limited by `diagnosisLimiter` (10/min).
- `POST /api/errors/:id/enrich` — `server/src/routes/errors.ts:270`. Backfills missing error details from n8n before diagnosis.
- `POST /api/errors/:id/fix` — `server/src/routes/errors.ts:282`. Body-less; triggers agentic fix.
- `POST /api/errors/:id/diagnosis-feedback` — `server/src/routes/errors.ts:240`. Thumbs up/down plus comment plus diagnosis snapshot.
- All mounted under `/api/errors` behind `requireAuth` (`server/src/index.ts:107`).

**Key files and functions.**
- `server/src/services/ai-fix.ts` — the heavyweight (~1000 lines):
  - `enrichErrorDetails(executionId)` — `:242`.
  - `diagnoseError(executionId, force)` — `:340`, simple single-shot diagnosis.
  - `complexDiagnoseError(executionId, force)` — `:508`, agentic multi-turn diagnosis (uses `runAgentLoop`).
  - `attemptAiFix(executionId, trigger)` — `:791`, agentic fix pipeline.
  - Helpers: `parseAiJsonResponse` (`:93`), `callAnthropicApi` (`:124`), `logTokenUsage` (`:160`), `fetchWorkflowFromN8n` (`:174`), `applyFixToN8n` (`:191`), `fetchExecutionFromN8n` (`:216`), `getDiagnosisTools` (`:459`), `getFixTools` (`:717`), `checkDailyLimit` (`:779`).
  - Section headers in `ai-fix.ts`: `n8n Knowledge Base` (`:41`), `Anthropic API helpers` (`:91`), `Token usage logging` (`:156`), `n8n API helpers` (`:172`), `Error enrichment` (`:214`), `Diagnosis Service (lightweight)` (`:315`), `Complex Diagnosis (agentic)` (`:419`), `Agentic Fix Service` (`:666`).
- `server/src/services/ai-agent.ts` — generic tool-use harness:
  - `runAgentLoop(options)` — `:98`. Given system prompt, tools, and `toolExecutor`, runs a multi-turn Claude conversation, executes `tool_use` blocks, returns `AgentResult` with final assistant text and aggregated `TokenUsage`.
  - Helpers: `extractText` (`:219`), `callAnthropic` (`:227`).
- `server/src/services/workflow-utils.ts` — workflow introspection and validation:
  - `extractNodesFromWorkflow`, `extractNodesWithConnections`, `replaceNodesInWorkflow`, `getConnectedNodes`, `getWorkflowMap`, `sanitizeWorkflowForAI`, `estimateTokens`, `extractNodeResultsFromExecution`, `validateFixedNodes`, `getExecutionErrorContext` — all exported at the top of the file.
- `client/src/pages/ErrorReporting.tsx` — UI. `DiagnosisPanel` (`:494`), `ExpandedError` with Fix button (`:642`), progress step indicator (`useProgressSteps` at `:474`).

**Agent loop architecture.** `runAgentLoop` (`ai-agent.ts:98`) owns the conversation: it posts messages to Anthropic, checks for `tool_use` blocks in the response, calls `toolExecutor(name, input)` for each tool, appends the result as a `tool_result` block, and iterates until the assistant returns an `end_turn` without further tool calls (or max turns is hit). Every iteration accumulates `input_tokens`/`output_tokens` into a `TokenUsage` object.

**Fix tools (`getFixTools`, `services/ai-fix.ts:717-776`).**
- `get_nodes` — full JSON for named nodes (`:720-729`).
- `get_connected_nodes` — upstream / downstream / both, 1 to 5 hops (`:730-742`).
- `get_full_workflow` — entire workflow; flagged expensive with node count and estimated tokens (`:743-751`).
- `validate_fix` — pre-submit validation against `validateFixedNodes` in `workflow-utils.ts` (names exist, credentials preserved, expression refs valid, types unchanged) (`:752-762`).
- `submit_fix` — final call with `fix_description` and only modified nodes (`:763-774`).

Diagnosis tools are separately defined in `getDiagnosisTools` (`ai-fix.ts:459`) for the complex-mode diagnosis loop.

**Apply path.** After `submit_fix` the service:
1. Merges `fixed_nodes` back into the full workflow via `replaceNodesInWorkflow`.
2. Calls `applyFixToN8n(baseUrl, apiKey, workflowRemoteId, updatedWorkflow)` (`ai-fix.ts:191-212`).
3. PUTs to `${baseUrl}/api/v1/workflows/${workflowRemoteId}` through `safeFetch` with a 15s timeout. Only the allowlist `N8N_WORKFLOW_PUT_FIELDS = ['name','nodes','connections','settings','staticData']` (`ai-fix.ts:189`) is sent.
4. Non-2xx responses throw with n8n's body captured.

**Data flow (fix).**
1. Operator clicks Fix on an error row, which calls `POST /api/errors/:id/fix`.
2. `attemptAiFix` checks daily limit (`checkDailyLimit`), verifies prior diagnosis exists, loads execution plus workflow metadata, decrypts the n8n API key.
3. Builds system prompt plus initial user message and kicks off `runAgentLoop` with `getFixTools`.
4. Tools read through `workflow-utils.ts` (no mutation yet). On `submit_fix`, `validateFixedNodes` runs again server-side.
5. `applyFixToN8n` pushes the PUT. Success/failure, token usage, and fix metadata are persisted on the execution row.

**Known issues.** None at time of writing.

**Deep dive.** Graphify's AI community is centered on `ai-fix.ts` (god node) with strong edges to `ai-agent.ts`, `workflow-utils.ts`, `safe-fetch`, `encryption`, and `routes/errors.ts`. See `graphify-out/` for the map.
