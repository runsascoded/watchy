-- One Slack thread per ISO week (specs/actor-intel.md): event msgs post as replies
-- under a "Week of M/D" OP whose scoreboard is chat.update'd as the week accrues.
CREATE TABLE weekly_threads (
  week_start TEXT PRIMARY KEY, -- Monday, ISO date (UTC)
  ts TEXT NOT NULL             -- Slack ts of the weekly OP in SLACK_CHANNEL_ID
);
