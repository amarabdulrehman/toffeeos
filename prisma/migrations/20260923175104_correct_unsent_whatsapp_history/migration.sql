-- Correct the WhatsApp message history that claims deliveries which never happened.
--
-- Until the Cloud API adapter replaced it, WhatsApp sending was a stub that logged every message and
-- reported success. No provider was ever configured on any deployment, so every row it wrote as SENT
-- is false: nothing was delivered. The new adapter stopped writing those, but the old rows remained,
-- and an owner reading their log still saw a history of messages that never left the building.
--
-- Scoped to rows with no providerMessageId. Meta returns a message id for every accepted send, so a
-- genuinely delivered message always carries one; the stub never set it. That makes this safe to run
-- at any time, including after real sending is switched on — it can only ever touch the stub's rows.
--
-- Updated, not deleted: the attempt did happen and the restaurant's log should still show it, with
-- an honest status and the reason attached.
UPDATE "WhatsAppMessageLog"
SET
  "status" = 'SKIPPED_NOT_CONFIGURED',
  "error" = 'Recorded as sent by an earlier version that could not send WhatsApp messages. Nothing was delivered.'
WHERE "status" = 'SENT'
  AND "providerMessageId" IS NULL;
