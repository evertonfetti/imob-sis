-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELED');

-- AlterTable
ALTER TABLE "licenses" ADD COLUMN     "billingMode" "BillingMode" NOT NULL DEFAULT 'AUTO';

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "mpPreferenceId" TEXT,
    "mpPaymentId" TEXT,
    "checkoutUrl" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_licenseId_createdAt_idx" ON "invoices"("licenseId", "createdAt");

-- CreateIndex
CREATE INDEX "invoices_status_dueAt_idx" ON "invoices"("status", "dueAt");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
