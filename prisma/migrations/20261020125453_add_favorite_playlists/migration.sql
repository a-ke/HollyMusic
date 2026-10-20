-- CreateTable
CREATE TABLE "FavoritePlaylist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cover" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "songCount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FavoritePlaylist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FavoritePlaylist_userId_createdAt_idx" ON "FavoritePlaylist"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FavoritePlaylist_userId_source_playlistId_key" ON "FavoritePlaylist"("userId", "source", "playlistId");
