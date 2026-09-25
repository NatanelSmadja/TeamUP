import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

const migration = name => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const participant = (i, rating = 3, keeper = false) => ({id: i, rating, is_goalkeeper: keeper});
let db;
const query = (sql, params = []) => db.query(sql, params);
const allocate = async (players, size = 5, teams = 3) => (await query(
  'select private.allocate_match_teams($1::jsonb,$2,$3) result', [JSON.stringify(players), size, teams])).rows[0].result;
const sizesOf = rows => Object.values(Object.groupBy(rows, p => p.team_number)).map(p => p.length).sort((a,b) => b-a);

beforeAll(async () => {
  db = new PGlite();
  // Minimal relational fixture with the columns/constraints used by the actual
  // production functions; tests execute PL/pgSQL, not a JS copy of the algorithm.
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
    create function public.has_group_permission(uuid,text) returns boolean language sql as $$select current_setting('test.allowed',true)='true'$$;
    create table public.matches(id uuid primary key,group_id uuid,status text,ratings_open boolean default false,ratings_closes_at timestamptz,capacity int,team_size int,team_count int,match_date date default current_date+1,start_time time default '12:00');
    create table public.profiles(id uuid primary key,base_rating numeric default 3,preferred_position text);
    create table public.match_registrations(match_id uuid references matches,user_id uuid references profiles,registration_status text,attended boolean default false,unique(match_id,user_id));
    create table public.match_guests(id uuid primary key,match_id uuid references matches,balance_rating numeric,preferred_position text);
    create table public.teams(id uuid primary key default gen_random_uuid(),match_id uuid references matches,name text,team_number int,generation_version int,color_key text,is_published boolean default false);
    create table public.team_players(id uuid primary key default gen_random_uuid(),team_id uuid not null references teams,user_id uuid references profiles,guest_id uuid references match_guests,assigned_position text,is_goalkeeper boolean,is_locked boolean default false,
      check ((user_id is not null)::int+(guest_id is not null)::int=1),unique(team_id,user_id),unique(team_id,guest_id));
    create table public.player_ratings(match_id uuid references matches,rater_user_id uuid references profiles,rated_user_id uuid references profiles,overall_rating int not null check(overall_rating between 1 and 5),teamwork_rating int,attack_rating int,defense_rating int,effort_rating int,sportsmanship_rating int,unique(match_id,rater_user_id,rated_user_id));
    create table public.mvp_votes(match_id uuid references matches,voter_user_id uuid references profiles,voted_user_id uuid references profiles,unique(match_id,voter_user_id));
    create table public.group_members(group_id uuid,user_id uuid references profiles);
    create table public.player_public_stats(group_id uuid,user_id uuid,avg_rating numeric,rating_count bigint,mvp_count bigint,games_count bigint,updated_at timestamptz,unique(group_id,user_id));
    create table public.goal_events(match_id uuid,scorer_user_id uuid,status text);
  `);
  await db.exec(migration('051_restore_team_balance_rating_snapshot'));
  await db.exec(migration('052_balanced_team_allocation'));
  const lifecycleSql = migration('033_safe_match_lifecycle_and_completion');
  await db.exec(lifecycleSql.slice(lifecycleSql.indexOf('create or replace function public.regenerate_balanced_teams'), lifecycleSql.indexOf('create or replace function public.set_match_attendance')));
  await db.exec(migration('053_distinct_team_regeneration'));
  await db.exec(migration('054_meaningful_team_reshuffle'));
  const ratingsSql = migration('018_secure_match_ratings_flow');
  await db.exec(ratingsSql.slice(ratingsSql.indexOf('create or replace function public.submit_match_ratings'), ratingsSql.indexOf('create or replace function public.notify_ratings_opened')));
  const statsSql = migration('039_mvp_wins_and_completed_game_stats');
  await db.exec(statsSql.slice(statsSql.indexOf('create or replace function public.get_match_mvp_winner'), statsSql.indexOf('-- A vote or a rating')));
}, 30000);

afterAll(async () => {await db?.close();});

describe('PostgreSQL allocation', () => {
  it.each([[2,[1,1]],[5,[3,2]],[6,[3,3]],[9,[5,4]],[10,[5,5]],[12,[5,5,2]],[15,[5,5,5]]])('fills nonempty capacities for %i players', async (n, expected) => {
    const rows = await allocate(Array.from({length:n},(_,i)=>participant(i)));
    expect(sizesOf(rows)).toEqual(expected);
    expect(new Set(rows.map(p=>p.id)).size).toBe(n);
  });

  it('spreads three goalkeepers over all three teams including the partial team', async () => {
    const rows = await allocate(Array.from({length:12},(_,i)=>participant(i,1+i%5,i<3)));
    for(const team of Object.values(Object.groupBy(rows,p=>p.team_number))) expect(team.filter(p=>p.is_goalkeeper)).toHaveLength(1);
  });

  it('keeps the partial team competitive instead of putting the weakest players there', async () => {
    const rows = await allocate([5,5,4,4,3,3,3,3,2,2,1,1].map((r,i)=>participant(i,r)));
    const averages = Object.values(Object.groupBy(rows,p=>p.team_number)).map(team=>team.reduce((s,p)=>s+p.rating,0)/team.length);
    expect(Math.max(...averages)-Math.min(...averages)).toBeLessThanOrEqual(0.4);
  });

  it('preserves every participant, capacity and goalkeeper coverage across many configurations', async () => {
    for(const size of [1,2,5,7]) for(const count of [2,3,4]) for(let n=2;n<=size*count;n++) {
      const keeperCount = n%5;
      const input=Array.from({length:n},(_,i)=>participant(i,1+((i*37+n)%401)/100,i<keeperCount));
      const rows=await allocate(input,size,count);
      const teams=Object.values(Object.groupBy(rows,p=>p.team_number));
      expect(rows.map(p=>p.id).sort((a,b)=>a-b)).toEqual(input.map(p=>p.id));
      expect(teams.length).toBeLessThanOrEqual(count);
      expect(teams.every(team=>team.length>0&&team.length<=size)).toBe(true);
      expect(teams.filter(team=>team.some(p=>p.is_goalkeeper))).toHaveLength(Math.min(keeperCount,teams.length,n));
    }
  },30000);

  it('rejects insufficient players, invalid ratings and excess capacity', async () => {
    await expect(allocate([participant(1)])).rejects.toThrow('לפחות שני');
    await expect(allocate(Array.from({length:16},(_,i)=>participant(i)))).rejects.toThrow('חורג');
    await expect(allocate([participant(1,6),participant(2)])).rejects.toThrow('דירוג');
  });

  it('supports the maximum 200-player configuration', async () => {
    const rows=await allocate(Array.from({length:200},(_,i)=>participant(i,1+((i*17)%401)/100,i<8)),50,4);
    expect(sizesOf(rows)).toEqual([50,50,50,50]);
  },30000);
});

describe('distinct alternative search', () => {
  const rows = ratings => ratings.map((rating,i)=>({id:String(i),team_number:Math.floor(i/2)+1,balance_rating_snapshot:rating,is_goalkeeper:false,is_locked:false}));
  const find = async players => (await query('select private.find_team_alternative($1::jsonb) plan',[JSON.stringify(players)])).rows[0].plan;
  const partition = async players => (await query('select private.team_partition($1::jsonb) p',[JSON.stringify(players)])).rows[0].p;
  it('ignores colors and player order when identifying the same partition', async () => {
    const source=rows([3,3,3,3]);
    expect(await partition(source)).toEqual(await partition([...source].reverse().map(p=>({...p,team_number:3-p.team_number}))));
    const plan=await find(source);
    expect(plan.status).toBe('balanced');
    expect(await partition(plan.allocation)).not.toEqual(await partition(source));
  });
  it('offers a less balanced candidate instead of silently applying it', async () => {
    const plan=await find(rows([5,1,4,2]));
    expect(plan.status).toBe('less_balanced');
    expect(plan.current_balance).toBe(100); expect(plan.candidate_balance).toBe(80);
  });
  it('meaningfully reshuffles the reported 15-player roster instead of only swapping two guests', async () => {
    const source=[3.55,3,3,3.76,2.90,3.94,3,3,3.32,3,3.08,3.81,3,3.07,3.31]
      .map((rating,i)=>({id:String(i),team_number:Math.floor(i/5)+1,balance_rating_snapshot:rating,is_goalkeeper:i===3||i===6,is_locked:false}));
    const plan=await find(source);
    expect(plan.status).not.toBe('no_alternative');
    expect(plan.changed_teammate_percent).toBeGreaterThanOrEqual(40);
    expect(await partition(plan.allocation)).not.toEqual(await partition(source));
    for(const t of [1,2,3]) {
      expect(plan.allocation.filter(p=>p.team_number===t)).toHaveLength(5);
      expect(plan.allocation.filter(p=>p.team_number===t&&p.is_goalkeeper)).toHaveLength(t===3?0:1);
    }
    expect((await find(source)).candidate_signature).toBe(plan.candidate_signature);
    const next=await find(plan.allocation);
    expect(await partition(next.allocation)).not.toEqual(await partition(plan.allocation));
  });
  it('reshuffles a maximum-size roster without losing players or changing capacities', async () => {
    const source=Array.from({length:200},(_,i)=>({id:String(i),team_number:Math.floor(i/50)+1,balance_rating_snapshot:1+((i*17)%401)/100,is_goalkeeper:i%50<2,is_locked:false}));
    const plan=await find(source);
    expect(plan.status).not.toBe('no_alternative');
    expect(new Set(plan.allocation.map(p=>p.id)).size).toBe(200);
    for(const t of [1,2,3,4]) {
      expect(plan.allocation.filter(p=>p.team_number===t)).toHaveLength(50);
      expect(plan.allocation.filter(p=>p.team_number===t&&p.is_goalkeeper)).toHaveLength(2);
    }
  },30000);
  it('finds no alternative for singletons or locked rosters', async () => {
    expect((await find(rows([3,3]).map((p,i)=>({...p,team_number:i+1})))).status).toBe('no_alternative');
    expect((await find(rows([3,3,3,3]).map(p=>({...p,is_locked:true})))).status).toBe('no_alternative');
  });
  it('preserves team size, goalkeeper count, locks and snapshots', async () => {
    const source=rows([3,3,3,3,3,3]).map((p,i)=>({...p,is_goalkeeper:i%2===0,is_locked:i===0}));
    const plan=await find(source);
    expect(plan.status).toBe('balanced');
    expect(plan.allocation.find(p=>p.id==='0').team_number).toBe(1);
    for(const t of [1,2,3]) {
      expect(plan.allocation.filter(p=>p.team_number===t)).toHaveLength(2);
      expect(plan.allocation.filter(p=>p.team_number===t&&p.is_goalkeeper)).toHaveLength(1);
    }
    expect(plan.allocation.map(p=>p.balance_rating_snapshot)).toEqual(source.map(p=>p.balance_rating_snapshot));
  });
});

describe('generation and rating integration', () => {
  beforeEach(async () => {
    await db.exec('truncate team_players,teams,match_guests,player_ratings,mvp_votes,match_registrations,group_members,player_public_stats,goal_events,profiles,matches cascade');
    await query("select set_config('test.allowed','true',false),set_config('test.user',$1,false)",[uid(1)]);
    await query("insert into matches(id,group_id,status,capacity,team_size,team_count) values($1,$2,'registration_closed',15,5,3)",[uid(100),uid(200)]);
    for(let i=1;i<=11;i++) {
      await query("insert into profiles values($1,$2,$3)",[uid(i),3,i<=3?'goalkeeper':'utility']);
      await query("insert into match_registrations values($1,$2,'confirmed',true)",[uid(100),uid(i)]);
      await query('insert into group_members values($1,$2)',[uid(200),uid(i)]);
    }
    await query("insert into match_guests values($1,$2,4,'utility')",[uid(20),uid(100)]);
  });

  it('publishes each registered player and guest once using the same completed-game mean as the leaderboard', async () => {
    for(const [id,group,status,score] of [[101,200,'completed',4],[102,200,'completed',5],[103,200,'cancelled',1],[104,201,'completed',1]]) {
      await query('insert into matches(id,group_id,status) values($1,$2,$3)',[uid(id),uid(group),status]);
      await query('insert into player_ratings(match_id,rater_user_id,rated_user_id,overall_rating) values($1,$2,$3,$4)',[uid(id),uid(2),uid(1),score]);
    }
    await query('select public.generate_balanced_teams($1)',[uid(100)]);
    const teams=(await query('select t.id,count(tp.id)::int size from teams t join team_players tp on tp.team_id=t.id where t.is_published group by t.id')).rows;
    expect(teams.map(t=>t.size).sort((a,b)=>b-a)).toEqual([5,5,2]);
    expect((await query('select count(distinct coalesce(user_id,guest_id))::int n from team_players')).rows[0].n).toBe(12);
    await query('select public.refresh_player_public_stats($1)',[uid(1)]);
    const rating=(await query('select balance_rating_snapshot from team_players where user_id=$1',[uid(1)])).rows[0].balance_rating_snapshot;
    const stats=(await query('select avg_rating from player_public_stats where user_id=$1',[uid(1)])).rows[0].avg_rating;
    expect(Number(rating)).toBe(4.5); expect(Number(stats)).toBe(Number(rating));
    await db.exec(migration('051_restore_team_balance_rating_snapshot'));
    expect(Number((await query('select balance_rating_snapshot from team_players where user_id=$1',[uid(1)])).rows[0].balance_rating_snapshot)).toBe(4.5);
    await expect(query('select public.generate_balanced_teams($1)',[uid(100)])).rejects.toThrow('לסגור');
  });

  it('rejects unauthorized generation and over-capacity rosters without creating teams', async () => {
    await query("select set_config('test.allowed','false',false)");
    await expect(query('select public.generate_balanced_teams($1)',[uid(100)])).rejects.toThrow('הרשאה');
    await query("select set_config('test.allowed','true',false)");
    await query('update matches set team_count=2 where id=$1',[uid(100)]);
    await expect(query('select public.generate_balanced_teams($1)',[uid(100)])).rejects.toThrow('חורג');
    expect((await query('select count(*)::int n from teams')).rows[0].n).toBe(0);
  });

  it('keeps generation history and restores the published generation if regeneration fails', async () => {
    await query('select public.generate_balanced_teams($1)',[uid(100)]);
    await query('select public.regenerate_balanced_teams($1)',[uid(100)]);
    expect((await query('select generation_version,count(*)::int n from teams where is_published group by generation_version')).rows).toEqual([{generation_version:2,n:3}]);
    expect((await query('select count(*)::int n from team_players')).rows[0].n).toBe(24);
    await query('update matches set team_count=2 where id=$1',[uid(100)]);
    await expect(query('select public.regenerate_balanced_teams($1)',[uid(100)])).rejects.toThrow('חורג');
    expect((await query('select status from matches where id=$1',[uid(100)])).rows[0].status).toBe('teams_published');
    expect((await query('select distinct generation_version from teams where is_published')).rows).toEqual([{generation_version:2}]);
  });

  const seedPreviewCase = async () => {
    await query("update matches set status='teams_published',capacity=4,team_size=2,team_count=2 where id=$1",[uid(100)]);
    for(const team of [1,2]) await query('insert into teams(id,match_id,name,team_number,generation_version,is_published) values($1,$2,$3,$4,1,true)',[uid(300+team),uid(100),`Team ${team}`,team]);
    for(const [i,rating] of [5,1,4,2].entries()) await query('insert into team_players(team_id,user_id,is_goalkeeper,balance_rating_snapshot) values($1,$2,false,$3)',[uid(301+Math.floor(i/2)),uid(i+1),rating]);
  };
  const preview = async () => (await query('select public.preview_team_regeneration($1) plan',[uid(100)])).rows[0].plan;
  const accept = (plan,allow=false) => query('select public.apply_team_regeneration($1,$2,$3,$4)',[uid(100),plan.expected_state,plan.candidate_signature,allow]);
  it('does not mutate on preview, requires consent and publishes the exact preview once', async () => {
    await seedPreviewCase();
    const plan=await preview();
    expect(plan.status).toBe('less_balanced');
    expect((await query('select count(*)::int n from teams')).rows[0].n).toBe(2);
    await expect(accept(plan)).rejects.toThrow('אישור');
    await expect(query('select public.regenerate_balanced_teams($1)',[uid(100)])).rejects.toThrow('אישור');
    expect((await query('select count(*)::int n from teams')).rows[0].n).toBe(2);
    await accept(plan,true);
    const actual=(await query('select tp.user_id,t.team_number,tp.balance_rating_snapshot from team_players tp join teams t on t.id=tp.team_id where t.is_published order by tp.user_id')).rows;
    const expected=plan.allocation.map(p=>({user_id:p.user_id,team_number:p.team_number,balance_rating_snapshot:String(p.balance_rating_snapshot)})).sort((a,b)=>a.user_id.localeCompare(b.user_id));
    expect(actual.map(p=>({...p,balance_rating_snapshot:String(Number(p.balance_rating_snapshot))}))).toEqual(expected);
    await expect(accept(plan,true)).rejects.toThrow('השתנתה');
    expect((await query('select count(*)::int n from teams')).rows[0].n).toBe(4);
  });
  it('rejects stale previews, tampered signatures, unauthorized users and matches that have started', async () => {
    await seedPreviewCase();
    const plan=await preview();
    await expect(accept({...plan,candidate_signature:'tampered'},true)).rejects.toThrow('השתנתה');
    await query('update team_players set is_locked=true where user_id=$1',[uid(1)]);
    await expect(accept(plan,true)).rejects.toThrow('השתנתה');
    await query("select set_config('test.allowed','false',false)");
    await expect(preview()).rejects.toThrow('הרשאה');
    await expect(accept(plan,true)).rejects.toThrow('הרשאה');
    await query("select set_config('test.allowed','true',false)");
    await query("update matches set match_date=current_date-1 where id=$1",[uid(100)]);
    await expect(preview()).rejects.toThrow('תחילת');
    await expect(accept(plan,true)).rejects.toThrow('תחילת');
    expect((await query('select count(*)::int n from teams')).rows[0].n).toBe(2);
  });
  it('leaves the current generation alone when no alternative exists', async () => {
    await seedPreviewCase();
    await query('update team_players set is_locked=true');
    const plan=await preview(); expect(plan.status).toBe('no_alternative');
    await expect(accept(plan,true)).rejects.toThrow('לא נמצאה');
    expect((await query('select count(*)::int n from teams where is_published')).rows[0].n).toBe(2);
  });

  const submit = (ratings, mvp=null) => query('select public.submit_match_ratings($1,$2::jsonb,$3)',[uid(100),JSON.stringify(ratings),mvp]);
  const score = (target,value) => ({user_id:uid(target),score:value});
  it('updates a rating instead of duplicating it and rejects self, absent, invalid and closed-window ratings', async () => {
    await query("update matches set status='completed',ratings_open=true where id=$1",[uid(100)]);
    await submit([score(2,4)],uid(3)); await submit([score(2,5)],uid(2));
    expect((await query('select overall_rating from player_ratings')).rows).toEqual([{overall_rating:5}]);
    expect((await query('select voted_user_id from mvp_votes')).rows).toEqual([{voted_user_id:uid(2)}]);
    await expect(submit([score(1,5)])).rejects.toThrow('עצמך');
    await expect(submit([score(2,6)])).rejects.toThrow('ציון');
    await query('update match_registrations set attended=false where user_id=$1',[uid(3)]);
    await expect(submit([score(3,4)])).rejects.toThrow('נכח');
    // An invalid later row must roll back the earlier update too.
    await expect(submit([score(2,1),score(3,4)])).rejects.toThrow('נכח');
    expect((await query('select overall_rating from player_ratings')).rows[0].overall_rating).toBe(5);
    await query("update matches set ratings_closes_at=now()-interval '1 minute'");
    await expect(submit([score(2,4)])).rejects.toThrow('סגור');
  });
});
