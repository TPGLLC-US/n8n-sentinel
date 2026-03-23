-- Extract token usage from n8n execution data using Postgres JSON functions.
-- Only tiny token count rows leave Postgres — no large data blobs transferred.
-- Supports: OpenAI, Anthropic, Google Gemini, Langchain (generic + response_metadata)
--
-- n8n stores execution data in "flatted" format: a flat JSON array where each
-- unique object is a separate element. Object values that are objects/arrays
-- are stored as string index references (e.g. "usage":"42" means the usage
-- object is at array index 42). We find parent objects that have both a
-- model name and a usage reference, then dereference to get token counts.
--
-- Requirements:
--   - n8n must be running on Postgres
--   - Credential "n8n Database" must point to n8n's own Postgres DB
--   - Tables: execution_entity (metadata), execution_data (run data)

WITH token_execs AS (
  SELECT e.id as execution_id, e."workflowId" as workflow_id, ed.data::jsonb as jdata
  FROM execution_entity e
  JOIN execution_data ed ON ed."executionId" = e.id
  WHERE e.id IN (__EXEC_IDS__)
    AND ed.data IS NOT NULL
    AND (
      ed.data LIKE '%prompt_tokens%'
      OR ed.data LIKE '%input_tokens%'
      OR ed.data LIKE '%promptTokens%'
      OR ed.data LIKE '%promptTokenCount%'
    )
    AND length(ed.data) < 50000000
),
-- Token counts: scan flat array for usage objects with token keys
usage_data AS (
  SELECT
    t.execution_id, t.workflow_id,
    COALESCE(
      (elem->>'prompt_tokens')::int,
      (elem->>'input_tokens')::int,
      (elem->>'promptTokens')::int,
      (elem->>'promptTokenCount')::int,
      0
    ) as tokens_input,
    COALESCE(
      (elem->>'completion_tokens')::int,
      (elem->>'output_tokens')::int,
      (elem->>'completionTokens')::int,
      (elem->>'candidatesTokenCount')::int,
      0
    ) as tokens_output
  FROM token_execs t,
    jsonb_array_elements(t.jdata) AS elems(elem)
  WHERE jsonb_typeof(elem) = 'object'
    AND (
      jsonb_exists(elem, 'prompt_tokens')
      OR jsonb_exists(elem, 'input_tokens')
      OR jsonb_exists(elem, 'promptTokens')
      OR jsonb_exists(elem, 'promptTokenCount')
    )
),
-- Model names: find config objects with 'model' key, dereference if numeric ref
model_data AS (
  SELECT DISTINCT ON (t.execution_id)
    t.execution_id,
    CASE
      WHEN elem->>'model' ~ '^\d+$' THEN t.jdata->>((elem->>'model')::int)
      ELSE elem->>'model'
    END as model
  FROM token_execs t,
    jsonb_array_elements(t.jdata) AS elems(elem)
  WHERE jsonb_typeof(elem) = 'object'
    AND jsonb_exists(elem, 'model')
  ORDER BY t.execution_id
)
SELECT
  u.execution_id,
  u.workflow_id,
  COALESCE(m.model, 'unknown') as model,
  u.tokens_input,
  u.tokens_output
FROM usage_data u
LEFT JOIN model_data m ON m.execution_id = u.execution_id
