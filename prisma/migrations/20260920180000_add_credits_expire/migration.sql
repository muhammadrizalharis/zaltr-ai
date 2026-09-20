-- Masa aktif paket: kredit hangus jadi 0 setelah tanggal ini (diisi saat admin beri kredit).
ALTER TABLE "User" ADD COLUMN "creditsExpireAt" TIMESTAMP(3);
