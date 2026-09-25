import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

let db;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role authenticated; create role anon;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
    create function public.is_system_admin() returns boolean language sql as $$select coalesce(current_setting('test.admin',true),'false')::boolean$$;
    create table storage.objects(bucket_id text, metadata jsonb);
    alter table storage.objects enable row level security;
    insert into storage.objects values
      ('profile-avatars','{"size":12000}'),('profile-avatars','{"size":"8000"}'),
      ('other','{"size":5000}'),('other','{}'),('other','{"size":"bad"}'),('other','{"size":-5}');
  `);
  const sql = readFileSync(new URL('../supabase/migrations/056_system_resource_usage.sql', import.meta.url), 'utf8');
  await db.exec(sql); await db.exec(sql);
}, 30000);
afterAll(async () => {await db?.close();});

describe('system resource usage access and measurements', () => {
  it('denies anonymous callers, ordinary users and missing identity', async () => {
    await db.exec('set role anon');
    await expect(db.query('select public.system_admin_resource_usage()')).rejects.toThrow();
    await db.exec('reset role; set role authenticated');
    await db.query("select set_config('test.user','00000000-0000-0000-0000-000000000001',false),set_config('test.admin','false',false)");
    await expect(db.query('select public.system_admin_resource_usage()')).rejects.toThrow('אין הרשאת מערכת');
    await db.query("select set_config('test.user','',false),set_config('test.admin','true',false)");
    await expect(db.query('select public.system_admin_resource_usage()')).rejects.toThrow('אין הרשאת מערכת');
  });
  it('measures every bucket for a system admin without exposing file paths', async () => {
    await db.exec('reset role; set role authenticated');
    await db.query("select set_config('test.user','00000000-0000-0000-0000-000000000001',false),set_config('test.admin','true',false)");
    const {rows} = await db.query('select public.system_admin_resource_usage() as usage');
    expect(rows[0].usage.database_bytes).toBeGreaterThan(0);
    expect(Date.parse(rows[0].usage.measured_at)).not.toBeNaN();
    expect(rows[0].usage.buckets).toEqual([
      {id:'other', file_count:4, bytes:5000, unknown_size_count:3},
      {id:'profile-avatars', file_count:2, bytes:20000, unknown_size_count:0},
    ]);
  });
  it('reports empty storage as zero files without failing', async () => {
    await db.exec('reset role; truncate storage.objects; set role authenticated');
    const {rows} = await db.query('select public.system_admin_resource_usage() as usage');
    expect(rows[0].usage.buckets).toEqual([]);
  });
});
