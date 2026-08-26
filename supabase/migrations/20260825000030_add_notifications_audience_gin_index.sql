-- Speeds up visibilityWhere's OR-based jsonb path/array_contains lookups
-- against notifications.audience, used by GET /notifications and the old
-- unread-count query. No application logic changes.
create index idx_notifications_audience_gin
on notifications
using gin (audience jsonb_path_ops);