-- AlterTable
ALTER TABLE `Purchase` MODIFY `currency` VARCHAR(191) NOT NULL DEFAULT 'usd';

-- AlterTable
ALTER TABLE `SummaryJob` ADD COLUMN `configVersionId` VARCHAR(191) NULL,
    ADD COLUMN `costEstimate` DOUBLE NULL,
    ADD COLUMN `modelUsed` VARCHAR(191) NULL,
    ADD COLUMN `tokensUsed` INTEGER NULL;

-- CreateTable
CREATE TABLE `ConfigComparison` (
    `id` VARCHAR(191) NOT NULL,
    `oldVersionId` VARCHAR(191) NOT NULL,
    `newVersionId` VARCHAR(191) NOT NULL,
    `testDepositionId` VARCHAR(191) NOT NULL,
    `oldSummaryJobId` VARCHAR(191) NULL,
    `newSummaryJobId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `promotedAt` DATETIME(3) NULL,

    INDEX `ConfigComparison_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PageContent` (
    `id` VARCHAR(191) NOT NULL,
    `route` VARCHAR(191) NOT NULL,
    `sections` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isProduction` BOOLEAN NOT NULL DEFAULT false,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PageContent_route_key`(`route`),
    INDEX `PageContent_isProduction_idx`(`isProduction`),
    INDEX `PageContent_route_idx`(`route`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PageContentVersion` (
    `id` VARCHAR(191) NOT NULL,
    `route` VARCHAR(191) NOT NULL,
    `sections` JSON NOT NULL,
    `version` INTEGER NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `promotedAt` DATETIME(3) NULL,

    INDEX `PageContentVersion_route_version_idx`(`route`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromptConfigVersion` (
    `id` VARCHAR(191) NOT NULL,
    `system` TEXT NOT NULL,
    `temperature` DOUBLE NOT NULL,
    `maxTokens` INTEGER NOT NULL,
    `modelName` VARCHAR(191) NULL,
    `isProduction` BOOLEAN NOT NULL DEFAULT false,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `promotedAt` DATETIME(3) NULL,
    `comparisonJobId` VARCHAR(191) NULL,

    INDEX `PromptConfigVersion_createdAt_idx`(`createdAt`),
    INDEX `PromptConfigVersion_isProduction_idx`(`isProduction`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `SummaryJob_userId_fkey` ON `SummaryJob`(`userId`);

-- CreateIndex
CREATE INDEX `SummaryJob_configVersionId_idx` ON `SummaryJob`(`configVersionId`);

-- AddForeignKey
ALTER TABLE `SummaryJob` ADD CONSTRAINT `SummaryJob_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
