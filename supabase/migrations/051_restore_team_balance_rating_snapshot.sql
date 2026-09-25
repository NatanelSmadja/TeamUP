-- Repair databases where the generation function was updated without the
-- snapshot column from migration 037. Safe to apply to already updated schemas.
-- Do not UPDATE historical rows: finalized matches reject team-player updates,
-- and existing snapshots must retain the rating used when teams were generated.
-- Missing historical snapshots receive the same neutral default as migration 037.
alter table public.team_players
  add column if not exists balance_rating_snapshot numeric(4,2) not null default 3
  check (balance_rating_snapshot between 1 and 5);

notify pgrst, 'reload schema';
