# Resources Inventory

**Purpose.** Build a cross-instance, cross-workflow inventory of the external resources each workflow touches — AI models/embeddings, Google docs/sheets/drive/slides, arbitrary credentials, generic HTTP domains — so operators can answer "which workflows reference this model or this credential?" in a single query.

**Entry point.**
- `GET /api/resources` — `server/src/routes/resources.ts:7`. Aggregates `workflow_resources` joined to `workflows` and `instances`, grouped by `(resource_type, resource_identifier, provider, instance)`. Mounted under `requireAuth` at `server/src/index.ts:102`.

**Key file and functions (`server/src/services/extractor.ts`).**
- `extractResources(workflow)` — exported entry at `:307-673`. Walks every node, emits zero or more `ResourceData` entries per node. Covered node families include:
  - AI nodes (`isAINode` at `:45`, `extractModelFromNode` at `:49-110`) → `ai_model` or `ai_embedding`.
  - Google Docs / Sheets (`:332-347`), Google Drive (`:350-370`), Google Slides (`:373-386`), plus URL-mined fallbacks via `extractGoogleResourceFromUrl` (`:179-222`).
  - Generic credential extraction via `getNodeCredential` (`:295`).
  - Domain extraction for HTTP Request nodes via `extractDomain` (`:153-158`) with `isInternalDomain` filter (`:160-177`).
- `extractTokenUsage(execution)` — `:675-…` (token usage extraction, used by ingest for execution rows).
- Helpers: `isExpression` (`:24`), `cleanValue` (`:37`), `isAINode` (`:45`), `cleanCredentialType` (`:112-151`), `extractDomain` (`:153`), `isInternalDomain` (`:160`), `extractGoogleResourceFromUrl` (`:179`), `isAuthKey` (`:224`), `scanParamArrays` (`:230`), `scanJsonForAuth` (`:248`), `hasExposedCredentials` (`:261`), `getNodeCredential` (`:295`), `resolveProvider` (`:600`), `extractTokensFromJson` (`:608`).

**Extraction flow.**
1. Reporter posts `telemetry_type = 'configuration'` → `routes/ingest.ts` calls `processConfiguration(instanceId, data)` (`services/ingest.ts:52`).
2. For each workflow, `extractResources(wf)` is called (`services/ingest.ts:74`), emitting de-duplicated `ResourceData` rows.
3. Rows are upserted into `workflow_resources` (`services/ingest.ts:138`) with columns `workflow_id`, `resource_type`, `resource_identifier`, `provider`, `node_name`, `credential_name`, `credential_id`, `credential_exposed`, `last_seen_at`.
4. `GET /api/resources` groups rows to present "this resource is touched by N workflows across M instances".

**Credential-exposure detection.** `hasExposedCredentials(node)` (`extractor.ts:261-293`) uses `isAuthKey`, `scanParamArrays`, and `scanJsonForAuth` to flag nodes that hold auth material inline instead of via an n8n credential reference. The boolean is stored on each row and exposed in the API response as `credential_exposed` (aggregated with `BOOL_OR` at `routes/resources.ts:17`) so the UI can highlight insecurely-configured nodes.

**Data flow.**
1. Ingest receives configuration payload per reporter schedule.
2. `processConfiguration` upserts workflows and replaces their `workflow_resources` rows.
3. `client/src/pages/Resources.tsx` calls `GET /api/resources`, groups by type / provider, and renders logos via `ProviderLogo` (`client/src/pages/Resources.tsx:74`) and type icons via `TypeIcon` (`:97`).

**Known issues.** None at time of writing.

**Deep dive.** See `graphify-out/` for the Resources community — `extractor.ts` is a god node with edges to every n8n node type and to `services/ingest.ts`. The per-instance drilldown endpoint `GET /api/instances/:id/resources` lives in `server/src/routes/instances.ts:616` and shares the same schema.
