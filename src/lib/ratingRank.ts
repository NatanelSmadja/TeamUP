type RankedPlayer = {id: string; avg_rating: number; rating_count: number};

export function compareRatingRank(a: RankedPlayer, b: RankedPlayer) {
  return b.avg_rating - a.avg_rating || b.rating_count - a.rating_count || a.id.localeCompare(b.id);
}
