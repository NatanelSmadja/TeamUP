-- Opening draw is intentionally presentation-only and has no persisted state.

drop function if exists public.draw_match_opening_teams(uuid);
drop table if exists public.match_opening_draws;
