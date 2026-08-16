-- Knowledge khusus Assistant (selain global & per-project).
ALTER TABLE "KnowledgeSource" ADD COLUMN "assistantId" TEXT;
ALTER TABLE "KnowledgeChunk" ADD COLUMN "assistantId" TEXT;
CREATE INDEX "KnowledgeSource_assistantId_idx" ON "KnowledgeSource"("assistantId");
CREATE INDEX "KnowledgeChunk_assistantId_idx" ON "KnowledgeChunk"("assistantId");
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "Assistant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
