import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

const matchA = '00000000-0000-0000-0000-000000000001';
const matchB = '00000000-0000-0000-0000-000000000002';
const groupA = '00000000-0000-0000-0000-000000000011';
const groupB = '00000000-0000-0000-0000-000000000012';
const playerA = '00000000-0000-0000-0000-000000000021';
const playerB = '00000000-0000-0000-0000-000000000022';
let db;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon;
    create table public.matches(id uuid primary key,group_id uuid,status text,ratings_open boolean,ratings_closes_at timestamptz);
    create table public.profiles(id uuid primary key,first_name text,last_name text,avatar_url text);
    create table public.mvp_votes(match_id uuid,voter_user_id uuid,voted_user_id uuid);
    create function public.is_group_member(p_group_id uuid) returns boolean language sql stable as
      $$select p_group_id::text=current_setting('test.group',true)$$;
    create function public.is_system_admin() returns boolean language sql stable as $$select false$$;
  `);
  const sql = readFileSync(new URL('../supabase/migrations/057_match_mvp_vote_totals.sql', import.meta.url), 'utf8');
  await db.exec(sql); await db.exec(sql);
  await db.query(`insert into public.matches values
    ('${matchA}','${groupA}','completed',false,now()),
    ('${matchB}','${groupB}','completed',false,now())`);
  await db.query(`insert into public.profiles values
    ('${playerA}','אורי','כהן',null),('${playerB}','דני','לוי',null)`);
  await db.query(`insert into public.mvp_votes values
    ('${matchA}','00000000-0000-0000-0000-000000000031','${playerA}'),
    ('${matchA}','00000000-0000-0000-0000-000000000032','${playerA}'),
    ('${matchA}','00000000-0000-0000-0000-000000000033','${playerB}'),
    ('${matchB}','00000000-0000-0000-0000-000000000034','${playerB}')`);
}, 30000);

afterAll(async () => {await db?.close();});

describe('per-match MVP vote totals', () => {
  it('returns only aggregate votes from the requested group and match', async () => {
    await db.query(`select set_config('test.group','${groupA}',false)`);
    await db.exec('set role authenticated');
    const {rows} = await db.query(`select * from public.get_match_mvp_vote_totals('${matchA}')`);
    expect(rows.map(row => [row.user_id, Number(row.vote_count)])).toEqual([[playerA, 2], [playerB, 1]]);
    expect(Object.keys(rows[0]).sort()).toEqual(['avatar_url', 'first_name', 'last_name', 'user_id', 'vote_count']);
    await expect(db.query(`select * from public.get_match_mvp_vote_totals('${matchB}')`)).rejects.toThrow();
  });

  it('hides totals until voting closes', async () => {
    await db.exec('reset role');
    await db.query(`update public.matches set ratings_open=true,ratings_closes_at=now()+interval '1 day' where id='${matchA}'`);
    await db.query(`select set_config('test.group','${groupA}',false)`);
    await db.exec('set role authenticated');
    const {rows} = await db.query(`select * from public.get_match_mvp_vote_totals('${matchA}')`);
    expect(rows).toEqual([]);
  });
});
