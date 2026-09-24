-- CreateEnum
CREATE TYPE "OwnerType" AS ENUM ('PERSON', 'COMPANY');

-- CreateEnum
CREATE TYPE "PropertyPurpose" AS ENUM ('SALE', 'RENT', 'SALE_AND_RENT');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('DRAFT', 'AVAILABLE', 'RESERVED', 'SOLD', 'RENTED', 'INACTIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "propertySeq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "owners" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "OwnerType" NOT NULL DEFAULT 'PERSON',
    "name" TEXT NOT NULL,
    "document" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_types" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "features" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortDescription" TEXT,
    "description" TEXT,
    "purpose" "PropertyPurpose" NOT NULL,
    "typeId" TEXT NOT NULL,
    "subtype" TEXT,
    "status" "PropertyStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerId" TEXT,
    "brokerId" TEXT,
    "salePrice" DECIMAL(14,2),
    "rentPrice" DECIMAL(14,2),
    "condominiumFee" DECIMAL(14,2),
    "propertyTax" DECIMAL(14,2),
    "minimumNegotiationPrice" DECIMAL(14,2),
    "bedrooms" INTEGER,
    "suites" INTEGER,
    "bathrooms" INTEGER,
    "parkingSpaces" INTEGER,
    "totalArea" DECIMAL(12,2),
    "usefulArea" DECIMAL(12,2),
    "builtArea" DECIMAL(12,2),
    "landArea" DECIMAL(12,2),
    "address" TEXT,
    "number" TEXT,
    "complement" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "showExactAddress" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_features" (
    "propertyId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,

    CONSTRAINT "property_features_pkey" PRIMARY KEY ("propertyId","featureId")
);

-- CreateIndex
CREATE INDEX "owners_companyId_name_idx" ON "owners"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "property_types_companyId_name_key" ON "property_types"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "features_companyId_slug_key" ON "features"("companyId", "slug");

-- CreateIndex
CREATE INDEX "properties_companyId_status_idx" ON "properties"("companyId", "status");

-- CreateIndex
CREATE INDEX "properties_companyId_published_city_idx" ON "properties"("companyId", "published", "city");

-- CreateIndex
CREATE INDEX "properties_ownerId_idx" ON "properties"("ownerId");

-- CreateIndex
CREATE INDEX "properties_brokerId_idx" ON "properties"("brokerId");

-- CreateIndex
CREATE UNIQUE INDEX "properties_companyId_code_key" ON "properties"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "properties_companyId_slug_key" ON "properties"("companyId", "slug");

-- AddForeignKey
ALTER TABLE "owners" ADD CONSTRAINT "owners_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_types" ADD CONSTRAINT "property_types_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "features" ADD CONSTRAINT "features_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "property_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_features" ADD CONSTRAINT "property_features_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_features" ADD CONSTRAINT "property_features_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;
