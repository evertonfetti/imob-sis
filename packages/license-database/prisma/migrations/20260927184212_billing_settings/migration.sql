-- CreateTable
CREATE TABLE "billing_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "advanceDays" INTEGER NOT NULL DEFAULT 5,
    "graceDays" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("id")
);
