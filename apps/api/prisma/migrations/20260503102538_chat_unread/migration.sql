-- CreateTable
CREATE TABLE "ChatRead" (
    "departmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatRead_pkey" PRIMARY KEY ("departmentId","userId")
);

-- CreateIndex
CREATE INDEX "ChatRead_userId_idx" ON "ChatRead"("userId");
