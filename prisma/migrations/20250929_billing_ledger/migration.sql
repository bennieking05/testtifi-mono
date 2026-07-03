-- Add columns to Purchase
ALTER TABLE `Purchase`
  ADD COLUMN `stripePaymentIntentId` VARCHAR(191) NULL,
  ADD COLUMN `amountCents` INT NOT NULL DEFAULT 0,
  ADD COLUMN `currency` VARCHAR(191) NOT NULL DEFAULT 'usd',
  ADD COLUMN `creditsAdded` INT NOT NULL DEFAULT 0,
  ADD COLUMN `status` ENUM('succeeded','refunded','partially_refunded','requires_payment_method') NOT NULL DEFAULT 'succeeded',
  ADD COLUMN `receiptUrl` VARCHAR(191) NULL,
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

-- Backfill new columns using legacy data
UPDATE `Purchase`
SET
  `stripePaymentIntentId` = COALESCE(`stripePaymentIntentId`, `id`),
  `amountCents` = COALESCE(`amountCents`, CAST(`amount` * 100 AS SIGNED)),
  `creditsAdded` = COALESCE(`creditsAdded`, `credits`),
  `status` = CASE WHEN `success` = 1 THEN 'succeeded' ELSE 'requires_payment_method' END;

-- Make new columns required
ALTER TABLE `Purchase`
  MODIFY `stripePaymentIntentId` VARCHAR(191) NOT NULL,
  MODIFY `amountCents` INTEGER NOT NULL,
  MODIFY `creditsAdded` INTEGER NOT NULL;

-- Drop legacy columns
ALTER TABLE `Purchase`
  DROP COLUMN `amount`,
  DROP COLUMN `credits`,
  DROP COLUMN `success`;

-- Ensure primary key uses cuid string (no change) and add unique constraint
ALTER TABLE `Purchase`
  ADD CONSTRAINT `Purchase_stripePaymentIntentId_key` UNIQUE (`stripePaymentIntentId`);

-- Create LedgerEntry table
CREATE TABLE `LedgerEntry` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('credit','debit','adjustment') NOT NULL,
    `credits` INT NOT NULL,
    `summaryId` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `purchaseId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LedgerEntry_idempotencyKey_key`(`idempotencyKey`),
    INDEX `LedgerEntry_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `LedgerEntry_purchaseId_idx`(`purchaseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Create CreditAllocation table
CREATE TABLE `CreditAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `debitLedgerId` VARCHAR(191) NOT NULL,
    `purchaseId` VARCHAR(191) NOT NULL,
    `creditsUsed` INT NOT NULL,

    INDEX `CreditAllocation_debitLedgerId_idx`(`debitLedgerId`),
    INDEX `CreditAllocation_purchaseId_idx`(`purchaseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Add foreign keys
ALTER TABLE `LedgerEntry` ADD CONSTRAINT `LedgerEntry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LedgerEntry` ADD CONSTRAINT `LedgerEntry_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `Purchase`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `CreditAllocation` ADD CONSTRAINT `CreditAllocation_debitLedgerId_fkey` FOREIGN KEY (`debitLedgerId`) REFERENCES `LedgerEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CreditAllocation` ADD CONSTRAINT `CreditAllocation_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `Purchase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill credit ledger entries for existing purchases
INSERT INTO `LedgerEntry` (`id`,`userId`,`type`,`credits`,`summaryId`,`description`,`idempotencyKey`,`purchaseId`,`createdAt`)
SELECT
  UUID(),
  p.userId,
  'credit',
  p.creditsAdded,
  NULL,
  CONCAT('Purchase ', p.stripePaymentIntentId),
  CONCAT('pi:', p.stripePaymentIntentId),
  p.id,
  p.createdAt
FROM `Purchase` p
WHERE p.creditsAdded > 0
  AND p.status = 'succeeded'
  AND NOT EXISTS (
    SELECT 1 FROM `LedgerEntry` le WHERE le.idempotencyKey = CONCAT('pi:', p.stripePaymentIntentId)
  );

-- Backfill refunds for purchases marked success = 0
INSERT INTO `LedgerEntry` (`id`,`userId`,`type`,`credits`,`summaryId`,`description`,`idempotencyKey`,`purchaseId`,`createdAt`)
SELECT
  UUID(),
  p.userId,
  'credit',
  -p.creditsAdded,
  NULL,
  CONCAT('Purchase reversal ', p.stripePaymentIntentId),
  CONCAT('refund:legacy:', p.stripePaymentIntentId),
  p.id,
  p.createdAt
FROM `Purchase` p
WHERE p.creditsAdded > 0
  AND p.status <> 'succeeded'
  AND NOT EXISTS (
    SELECT 1 FROM `LedgerEntry` le WHERE le.idempotencyKey = CONCAT('refund:legacy:', p.stripePaymentIntentId)
  );

