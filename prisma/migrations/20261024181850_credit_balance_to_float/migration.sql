-- DropIndex
DROP INDEX "KnowledgeChunk_embedding_hnsw_idx";

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "creditBalance" SET DEFAULT 0,
ALTER COLUMN "creditBalance" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "creditUsed" SET DEFAULT 0,
ALTER COLUMN "creditUsed" SET DATA TYPE DOUBLE PRECISION;

-- Pulihkan index HNSW (kolom vector tak dimodelkan Prisma; jangan ikut ter-drop).
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_embedding_hnsw_idx"
  ON "KnowledgeChunk" USING hnsw (embedding vector_cosine_ops);
