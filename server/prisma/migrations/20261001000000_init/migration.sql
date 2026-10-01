-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('MAIN_LEADER');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('OK', 'NOT_OK');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "PvSource" AS ENUM ('EXCEL', 'MANUAL');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MAIN_LEADER',
    "memberId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "abNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'OK',
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "sponsorId" TEXT,
    "proposerId" TEXT,
    "externalSponsorAbNumber" TEXT,
    "externalSponsorName" TEXT,
    "externalProposerAbNumber" TEXT,
    "externalProposerName" TEXT,
    "joiningDate" DATE,
    "mobile" TEXT,
    "city" TEXT,
    "district" TEXT,
    "state" TEXT,
    "reportProposerAbNumber" TEXT,
    "reportProposerName" TEXT,
    "pucHomeDelivery" BOOLEAN,
    "displayWall" BOOLEAN,
    "reportUpdatedAt" TIMESTAMP(3),
    "lastImportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyPv" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "selfPv" DECIMAL(14,2) NOT NULL,
    "source" "PvSource" NOT NULL,
    "importId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyPv_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PvAuditLog" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "oldPv" DECIMAL(14,2),
    "newPv" DECIMAL(14,2) NOT NULL,
    "source" "PvSource" NOT NULL,
    "importId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PvAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sheetName" TEXT,
    "fyStartYear" INTEGER NOT NULL,
    "months" JSONB NOT NULL DEFAULT '[]',
    "status" "ImportStatus" NOT NULL DEFAULT 'PROCESSING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "pvValuesChanged" INTEGER NOT NULL DEFAULT 0,
    "proposerLinked" INTEGER NOT NULL DEFAULT 0,
    "unmappedCount" INTEGER NOT NULL DEFAULT 0,
    "newUnmappedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnmappedRecord" (
    "id" TEXT NOT NULL,
    "abNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "joiningDate" DATE,
    "mobile" TEXT,
    "city" TEXT,
    "district" TEXT,
    "state" TEXT,
    "proposerAbNumber" TEXT,
    "proposerName" TEXT,
    "pucHomeDelivery" BOOLEAN,
    "displayWall" BOOLEAN,
    "monthlyPv" JSONB NOT NULL DEFAULT '{}',
    "firstImportId" TEXT,
    "lastImportId" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnmappedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_role_key" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "User_memberId_key" ON "User"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Member_abNumber_key" ON "Member"("abNumber");

-- CreateIndex
CREATE INDEX "Member_sponsorId_idx" ON "Member"("sponsorId");

-- CreateIndex
CREATE INDEX "Member_proposerId_idx" ON "Member"("proposerId");

-- CreateIndex
CREATE INDEX "Member_joiningDate_idx" ON "Member"("joiningDate");

-- CreateIndex
CREATE INDEX "Member_reportProposerAbNumber_idx" ON "Member"("reportProposerAbNumber");

-- CreateIndex
CREATE INDEX "Member_name_idx" ON "Member"("name");

-- CreateIndex
CREATE INDEX "Member_status_kycStatus_idx" ON "Member"("status", "kycStatus");

-- CreateIndex
CREATE INDEX "MonthlyPv_year_month_selfPv_idx" ON "MonthlyPv"("year", "month", "selfPv");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyPv_memberId_year_month_key" ON "MonthlyPv"("memberId", "year", "month");

-- CreateIndex
CREATE INDEX "PvAuditLog_memberId_createdAt_idx" ON "PvAuditLog"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "PvAuditLog_importId_idx" ON "PvAuditLog"("importId");

-- CreateIndex
CREATE INDEX "ImportBatch_startedAt_idx" ON "ImportBatch"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UnmappedRecord_abNumber_key" ON "UnmappedRecord"("abNumber");

-- CreateIndex
CREATE INDEX "UnmappedRecord_proposerAbNumber_idx" ON "UnmappedRecord"("proposerAbNumber");

-- CreateIndex
CREATE INDEX "UnmappedRecord_joiningDate_idx" ON "UnmappedRecord"("joiningDate");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyPv" ADD CONSTRAINT "MonthlyPv_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvAuditLog" ADD CONSTRAINT "PvAuditLog_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity guards (hand-written; Prisma schema language cannot express CHECK constraints)
ALTER TABLE "Member" ADD CONSTRAINT "Member_not_own_sponsor" CHECK ("sponsorId" IS NULL OR "sponsorId" <> "id");
ALTER TABLE "Member" ADD CONSTRAINT "Member_not_own_proposer" CHECK ("proposerId" IS NULL OR "proposerId" <> "id");
ALTER TABLE "MonthlyPv" ADD CONSTRAINT "MonthlyPv_month_range" CHECK ("month" BETWEEN 1 AND 12);
ALTER TABLE "MonthlyPv" ADD CONSTRAINT "MonthlyPv_non_negative" CHECK ("selfPv" >= 0);
ALTER TABLE "PvAuditLog" ADD CONSTRAINT "PvAuditLog_month_range" CHECK ("month" BETWEEN 1 AND 12);
