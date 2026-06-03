-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('text', 'number', 'date', 'select', 'person');

-- CreateTable
CREATE TABLE "BoardField" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FieldType" NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "options" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardFieldValue" (
    "cardId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "valueText" TEXT,
    "valueNumber" DOUBLE PRECISION,
    "valueDate" TIMESTAMP(3),
    "valueUserId" TEXT,
    "valueOptionId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardFieldValue_pkey" PRIMARY KEY ("cardId","fieldId")
);

-- CreateIndex
CREATE INDEX "BoardField_boardId_idx" ON "BoardField"("boardId");

-- CreateIndex
CREATE INDEX "BoardField_boardId_position_idx" ON "BoardField"("boardId", "position");

-- CreateIndex
CREATE INDEX "CardFieldValue_fieldId_idx" ON "CardFieldValue"("fieldId");

-- AddForeignKey
ALTER TABLE "BoardField" ADD CONSTRAINT "BoardField_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardFieldValue" ADD CONSTRAINT "CardFieldValue_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardFieldValue" ADD CONSTRAINT "CardFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "BoardField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
