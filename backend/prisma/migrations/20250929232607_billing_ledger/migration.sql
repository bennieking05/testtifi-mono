/*
  Warnings:

  - You are about to drop the column `deponent` on the `SummaryJob` table. All the data in the column will be lost.
  - You are about to drop the column `summaryName` on the `SummaryJob` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE `CreditAllocation` DROP FOREIGN KEY `CreditAllocation_debitLedgerId_fkey`;

-- DropForeignKey
ALTER TABLE `CreditAllocation` DROP FOREIGN KEY `CreditAllocation_purchaseId_fkey`;

-- DropForeignKey
ALTER TABLE `LedgerEntry` DROP FOREIGN KEY `LedgerEntry_userId_fkey`;

-- AlterTable
ALTER TABLE `Purchase` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `SummaryJob` DROP COLUMN `deponent`,
    DROP COLUMN `summaryName`;

-- AddForeignKey
ALTER TABLE `LedgerEntry` ADD CONSTRAINT `LedgerEntry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CreditAllocation` ADD CONSTRAINT `CreditAllocation_debitLedgerId_fkey` FOREIGN KEY (`debitLedgerId`) REFERENCES `LedgerEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CreditAllocation` ADD CONSTRAINT `CreditAllocation_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `Purchase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
