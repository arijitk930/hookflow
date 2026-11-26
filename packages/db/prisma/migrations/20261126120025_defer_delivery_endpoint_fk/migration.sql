-- Check Delivery -> Endpoint at COMMIT instead of mid-statement.
-- Deleting a User cascades to its Endpoints and Events; the Deliveries go away through
-- the Event cascade, which PostgreSQL runs after it would otherwise check this key.
-- Hard-deleting an endpoint that still has deliveries continues to fail.
-- (Prisma's schema cannot express deferrability, so this is hand-written.)
ALTER TABLE "Delivery" ALTER CONSTRAINT "Delivery_endpointId_fkey" DEFERRABLE INITIALLY DEFERRED;
