-- Bloco 11 (SaaS) — Fase 1: estado local da licença (uma linha só, a instalação inteira).
CREATE TABLE "license_state" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "fingerprint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "planName" TEXT,
    "limits" JSONB,
    "message" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "license_state_pkey" PRIMARY KEY ("id")
);
