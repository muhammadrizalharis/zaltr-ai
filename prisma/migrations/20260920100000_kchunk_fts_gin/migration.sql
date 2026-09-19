-- Indeks full-text (GIN) untuk pencarian keyword pada retrieval hybrid (RRF).
-- Konfigurasi 'simple' dipilih agar netral bahasa (campuran Indonesia/Inggris/kode).
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_content_fts_idx"
  ON "KnowledgeChunk" USING gin (to_tsvector('simple', "content"));
