-- Indeks ANN (HNSW, cosine) untuk pencarian vektor RAG cepat saat basis
-- pengetahuan membesar. Kolom embedding = vector(1024); pgvector >= 0.5.
-- Cocok dgn operator <=> (cosine) yang dipakai retrieve().
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_embedding_hnsw_idx"
  ON "KnowledgeChunk" USING hnsw (embedding vector_cosine_ops);
