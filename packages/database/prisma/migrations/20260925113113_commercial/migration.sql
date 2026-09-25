-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'SENT', 'UNDER_REVIEW', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProposalParty" AS ENUM ('BUYER', 'OWNER');

-- AlterTable
ALTER TABLE "pipeline_stages" ADD COLUMN     "systemKey" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "ref" TEXT;

-- CreateTable
CREATE TABLE "visits" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "brokerId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "status" "VisitStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "feedback" TEXT,
    "cancelReason" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "ownerId" TEXT,
    "createdById" TEXT,
    "askingPrice" DECIMAL(14,2) NOT NULL,
    "proposedPrice" DECIMAL(14,2) NOT NULL,
    "downPayment" DECIMAL(14,2),
    "financingAmount" DECIMAL(14,2),
    "conditions" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_revisions" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "conditions" TEXT,
    "party" "ProposalParty" NOT NULL DEFAULT 'BUYER',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visits_companyId_scheduledAt_idx" ON "visits"("companyId", "scheduledAt");

-- CreateIndex
CREATE INDEX "visits_brokerId_scheduledAt_idx" ON "visits"("brokerId", "scheduledAt");

-- CreateIndex
CREATE INDEX "visits_leadId_idx" ON "visits"("leadId");

-- CreateIndex
CREATE INDEX "visits_propertyId_idx" ON "visits"("propertyId");

-- CreateIndex
CREATE INDEX "proposals_companyId_status_idx" ON "proposals"("companyId", "status");

-- CreateIndex
CREATE INDEX "proposals_leadId_idx" ON "proposals"("leadId");

-- CreateIndex
CREATE INDEX "proposals_propertyId_status_idx" ON "proposals"("propertyId", "status");

-- CreateIndex
CREATE INDEX "proposals_status_validUntil_idx" ON "proposals"("status", "validUntil");

-- CreateIndex
CREATE INDEX "proposal_revisions_proposalId_createdAt_idx" ON "proposal_revisions"("proposalId", "createdAt");

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_revisions" ADD CONSTRAINT "proposal_revisions_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Papéis fixos das etapas do funil para a automação comercial (funis que já existem).
UPDATE "pipeline_stages" SET "systemKey" = 'VISIT_SCHEDULED' WHERE "name" = 'Visita agendada' AND "systemKey" IS NULL;
UPDATE "pipeline_stages" SET "systemKey" = 'VISIT_DONE'      WHERE "name" = 'Visita realizada' AND "systemKey" IS NULL;
UPDATE "pipeline_stages" SET "systemKey" = 'PROPOSAL'        WHERE "name" = 'Proposta'         AND "systemKey" IS NULL;
UPDATE "pipeline_stages" SET "systemKey" = 'NEGOTIATION'     WHERE "name" = 'Negociação'       AND "systemKey" IS NULL;
UPDATE "pipeline_stages" SET "systemKey" = 'WON'             WHERE "type" = 'WON'              AND "systemKey" IS NULL;
