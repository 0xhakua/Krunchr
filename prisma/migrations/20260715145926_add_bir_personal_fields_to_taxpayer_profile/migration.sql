-- AlterTable
ALTER TABLE "TaxpayerProfile" ADD COLUMN     "citizenship" TEXT,
ADD COLUMN     "civilStatus" TEXT,
ADD COLUMN     "claimingForeignTaxCredits" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "foreignTaxNumber" TEXT;
