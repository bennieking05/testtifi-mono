/*
  Warnings:

  - Added the required column `success` to the `Purchase` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `Purchase` ADD COLUMN `success` BOOLEAN NOT NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `companyName` VARCHAR(191) NULL;
