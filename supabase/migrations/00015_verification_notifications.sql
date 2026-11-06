-- ============================================================================
-- HomeOps Migration 00015: Tell technicians when their application status changes
-- ============================================================================
-- Operators approve/reject on the dashboard, which writes to the database directly and
-- can't message Telegram. The Worker's minute sweep compares verification_status with the
-- last status it announced and messages the technician when they differ.

ALTER TABLE technician_profiles ADD COLUMN IF NOT EXISTS verification_notified_status verification_status;

-- Existing technicians already know their status; don't announce it again.
UPDATE technician_profiles SET verification_notified_status = verification_status WHERE verification_notified_status IS NULL;
