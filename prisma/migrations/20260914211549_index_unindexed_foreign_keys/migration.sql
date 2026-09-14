-- CreateIndex
CREATE INDEX "Invite_tenantId_branchId_idx" ON "Invite"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "Invite_tenantId_roleId_idx" ON "Invite"("tenantId", "roleId");

-- CreateIndex
CREATE INDEX "Membership_tenantId_roleId_idx" ON "Membership"("tenantId", "roleId");

-- CreateIndex
CREATE INDEX "Order_tenantId_tableId_idx" ON "Order"("tenantId", "tableId");

-- CreateIndex
CREATE INDEX "Order_tenantId_customerId_idx" ON "Order"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "Order_tenantId_createdById_idx" ON "Order"("tenantId", "createdById");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_locationId_idx" ON "StockMovement"("tenantId", "locationId");

-- CreateIndex
CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_subscriptionId_idx" ON "SubscriptionPayment"("subscriptionId");
