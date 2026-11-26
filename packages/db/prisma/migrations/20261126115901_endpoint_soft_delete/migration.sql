-- DropForeignKey
ALTER TABLE "Delivery" DROP CONSTRAINT "Delivery_endpointId_fkey";

-- AlterTable
ALTER TABLE "Endpoint" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
