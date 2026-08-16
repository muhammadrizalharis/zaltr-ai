-- Berbagi percakapan read-only via token unik.
ALTER TABLE "Conversation" ADD COLUMN "shareToken" TEXT;
CREATE UNIQUE INDEX "Conversation_shareToken_key" ON "Conversation"("shareToken");
