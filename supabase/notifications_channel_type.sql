-- Optional: allow notifications.type = 'channel' for Lab Team fanout.
-- Until applied, postChannelMessage uses type 'mention' with title '#Lab Team'.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'mention', 'follow', 'like', 'comment',
    'task_claimed', 'task_completed', 'task_submitted', 'task_rejected',
    'tool_install', 'dm', 'channel'
  ));
