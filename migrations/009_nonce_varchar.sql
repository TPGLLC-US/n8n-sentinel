-- Migration 009: Change nonce_cache.nonce from UUID to VARCHAR(64)
-- Reporter generates base36 nonces (e.g., "mmwklx40-4xke8fahrmr"), not UUIDs

ALTER TABLE nonce_cache ALTER COLUMN nonce TYPE VARCHAR(64);
