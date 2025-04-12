-- AlterTable
ALTER TABLE `RefreshToken` MODIFY `token` VARCHAR(512) NOT NULL,
    MODIFY `replacedByToken` VARCHAR(512) NULL;
