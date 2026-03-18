-- Replace interval-based scheduling with hour-based scheduling
INSERT OR IGNORE INTO settings (key, value) VALUES ('cron_hours', '3,12');
DELETE FROM settings WHERE key = 'cron_interval_minutes';
