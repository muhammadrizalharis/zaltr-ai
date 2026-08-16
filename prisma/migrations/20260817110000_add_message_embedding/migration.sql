-- Embedding pesan untuk pencarian semantik riwayat chat (nullable).
ALTER TABLE "Message" ADD COLUMN "embedding" vector(1024);
