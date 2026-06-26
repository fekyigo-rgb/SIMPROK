-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Authority" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Authority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionAuthority" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PositionAuthority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PositionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalMatrix" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "positionId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalMatrix_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Position_code_key" ON "Position"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Authority_code_key" ON "Authority"("code");

-- CreateIndex
CREATE INDEX "PositionAuthority_positionId_idx" ON "PositionAuthority"("positionId");

-- CreateIndex
CREATE INDEX "PositionAuthority_authorityId_idx" ON "PositionAuthority"("authorityId");

-- CreateIndex
CREATE UNIQUE INDEX "PositionAuthority_positionId_authorityId_key" ON "PositionAuthority"("positionId", "authorityId");

-- CreateIndex
CREATE INDEX "PositionAssignment_userId_idx" ON "PositionAssignment"("userId");

-- CreateIndex
CREATE INDEX "PositionAssignment_positionId_idx" ON "PositionAssignment"("positionId");

-- CreateIndex
CREATE INDEX "PositionAssignment_isActive_idx" ON "PositionAssignment"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalMatrix_code_key" ON "ApprovalMatrix"("code");

-- CreateIndex
CREATE INDEX "ApprovalMatrix_positionId_idx" ON "ApprovalMatrix"("positionId");

-- AddForeignKey
ALTER TABLE "PositionAuthority" ADD CONSTRAINT "PositionAuthority_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionAuthority" ADD CONSTRAINT "PositionAuthority_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "Authority"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionAssignment" ADD CONSTRAINT "PositionAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionAssignment" ADD CONSTRAINT "PositionAssignment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalMatrix" ADD CONSTRAINT "ApprovalMatrix_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
