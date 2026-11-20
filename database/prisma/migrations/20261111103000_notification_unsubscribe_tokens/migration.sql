ALTER TABLE "NotificationDelivery" ADD COLUMN "unsubscribeTokenHash" CHAR(64);
CREATE UNIQUE INDEX "NotificationDelivery_unsubscribeTokenHash_key" ON "NotificationDelivery"("unsubscribeTokenHash");
