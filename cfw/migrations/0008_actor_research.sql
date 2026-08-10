-- Threaded actor-bits replies (specs/actor-intel.md):
-- slack_posts.reply_ts: NULL = reply not yet processed, '' = processed/no-reply, else the reply's Slack ts.
-- actors.research: cached Claude-written blurb (one per actor, reused across their events).
ALTER TABLE slack_posts ADD COLUMN reply_ts TEXT;
-- Pre-existing posts are grandfathered: only messages posted after this ships get replies.
UPDATE slack_posts SET reply_ts = '';
ALTER TABLE actors ADD COLUMN research TEXT;
ALTER TABLE actors ADD COLUMN research_at TEXT;
