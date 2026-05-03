/*
  Warnings:

  - You are about to drop the column `workspaceId` on the `Label` table. All the data in the column will be lost.
  - Added the required column `boardId` to the `Label` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Label" DROP CONSTRAINT "Label_workspaceId_fkey";

-- DropIndex
DROP INDEX "Label_workspaceId_idx";

-- AlterTable
ALTER TABLE "Label" DROP COLUMN "workspaceId",
ADD COLUMN     "boardId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Label_boardId_idx" ON "Label"("boardId");

-- AddForeignKey
ALTER TABLE "Label" ADD CONSTRAINT "Label_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
