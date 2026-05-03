ALTER TABLE "MediaItem" ADD COLUMN "chatAttachmentId" TEXT;
CREATE UNIQUE INDEX "MediaItem_chatAttachmentId_key" ON "MediaItem"("chatAttachmentId");
