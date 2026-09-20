-- Penanda pengingat masa aktif (H-3) sudah dikirim; di-reset saat top-up.
ALTER TABLE "User" ADD COLUMN "expiryRemindedAt" TIMESTAMP(3);
