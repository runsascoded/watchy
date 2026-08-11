-- Top owned repos by stars: JSON [{"n": full_name, "s": stars}] (top 3, stars > 0).
-- Lets Slack msgs / UI tease "MzeroMiko's VMamba (3.4k ⭐)" alongside star_sum.
ALTER TABLE actors ADD COLUMN top_repos TEXT;
