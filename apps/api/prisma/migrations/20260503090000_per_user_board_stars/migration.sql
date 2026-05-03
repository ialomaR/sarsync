-- Per-user board stars: replace global Board.starred with BoardStar join table.

CREATE TABLE "BoardStar" (
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardStar_pkey" PRIMARY KEY ("boardId", "userId")
);

CREATE INDEX "BoardStar_userId_idx" ON "BoardStar"("userId");

ALTER TABLE "BoardStar" ADD CONSTRAINT "BoardStar_boardId_fkey"
  FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoardStar" ADD CONSTRAINT "BoardStar_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate any existing global stars to the workspace creator (admin) so we
-- don't lose the seed/demo data outright.
INSERT INTO "BoardStar" ("boardId", "userId")
SELECT b."id", m."userId"
FROM "Board" b
JOIN "Membership" m ON m."workspaceId" = b."workspaceId" AND m."role" = 'admin'
WHERE b."starred" = true
ON CONFLICT DO NOTHING;

ALTER TABLE "Board" DROP COLUMN "starred";
