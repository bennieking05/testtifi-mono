-- Safe billing migration: add missing Purchase columns, create LedgerEntry and CreditAllocation
-- Assumes MySQL 8.x (Cloud SQL). Designed to be backward compatible and non‑destructive.

-- MySQL prior to 8.4 does not support ADD COLUMN IF NOT EXISTS inside a multi alter
-- so we emulate the behaviour with conditional dynamic SQL per column
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Purchase' AND COLUMN_NAME = 'amountCents'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `Purchase` ADD COLUMN `amountCents` INT NULL;',
  'SELECT 1;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Purchase' AND COLUMN_NAME = 'creditsAdded'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `Purchase` ADD COLUMN `creditsAdded` INT NULL;',
  'SELECT 1;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Purchase' AND COLUMN_NAME = 'stripePaymentIntentId'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `Purchase` ADD COLUMN `stripePaymentIntentId` VARCHAR(191) NULL;',
  'SELECT 1;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Purchase' AND COLUMN_NAME = 'currency'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `Purchase` ADD COLUMN `currency` VARCHAR(10) NULL;',
  'SELECT 1;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Purchase' AND COLUMN_NAME = 'updatedAt'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `Purchase` ADD COLUMN `updatedAt` DATETIME(3) NULL;',
  'SELECT 1;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Backfill sensible defaults for existing rows
UPDATE `Purchase`
  SET
    `amountCents` = COALESCE(`amountCents`, 0),
    `creditsAdded` = COALESCE(`creditsAdded`, 0),
    `currency` = COALESCE(`currency`, 'usd'),
    `updatedAt` = COALESCE(`updatedAt`, NOW(3)),
    `stripePaymentIntentId` = CASE
      WHEN `stripePaymentIntentId` IS NULL OR `stripePaymentIntentId` = ''
        THEN CONCAT('legacy-', `id`)
      ELSE `stripePaymentIntentId`
    END;

-- 3) Enforce NOT NULL constraints and uniqueness after backfill
ALTER TABLE `Purchase`
  MODIFY COLUMN `amountCents` INT NOT NULL,
  MODIFY COLUMN `creditsAdded` INT NOT NULL,
  MODIFY COLUMN `currency` VARCHAR(10) NOT NULL,
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL,
  MODIFY COLUMN `stripePaymentIntentId` VARCHAR(191) NOT NULL;

-- Add unique index on stripePaymentIntentId if it doesn't already exist
SET @have_idx := (
  SELECT COUNT(1)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'Purchase'
    AND INDEX_NAME = 'Purchase_stripePaymentIntentId_key'
);
SET @sql := IF(@have_idx = 0,
  'ALTER TABLE `Purchase` ADD UNIQUE INDEX `Purchase_stripePaymentIntentId_key` (`stripePaymentIntentId`);',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Create LedgerEntry table if not exists
CREATE TABLE IF NOT EXISTS `LedgerEntry` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `type` ENUM('credit','debit','adjustment') NOT NULL,
  `credits` INT NOT NULL,
  `summaryId` VARCHAR(191) NULL,
  `description` TEXT NULL,
  `idempotencyKey` VARCHAR(191) NULL,
  `purchaseId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `LedgerEntry_idempotencyKey_key` (`idempotencyKey`),
  KEY `LedgerEntry_userId_createdAt_idx` (`userId`, `createdAt`),
  KEY `LedgerEntry_purchaseId_idx` (`purchaseId`),
  CONSTRAINT `LedgerEntry_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `Purchase`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 5) Create CreditAllocation table if not exists
CREATE TABLE IF NOT EXISTS `CreditAllocation` (
  `id` VARCHAR(191) NOT NULL,
  `debitLedgerId` VARCHAR(191) NOT NULL,
  `purchaseId` VARCHAR(191) NOT NULL,
  `creditsUsed` INT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `CreditAllocation_debitLedgerId_idx` (`debitLedgerId`),
  KEY `CreditAllocation_purchaseId_idx` (`purchaseId`),
  CONSTRAINT `CreditAllocation_debitLedgerId_fkey` FOREIGN KEY (`debitLedgerId`) REFERENCES `LedgerEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `CreditAllocation_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `Purchase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


