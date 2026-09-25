import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
const first='00000000-0000-0000-0000-000000000001';
const second='00000000-0000-0000-0000-000000000002';
const version='00000000-0000-0000-0000-000000000003';
let db;
beforeAll(async () => {
  db=new PGlite();
  await db.exec(`create role authenticated; create role anon; create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
    grant usage on schema auth,storage to authenticated;
    create table profiles(id uuid primary key,avatar_url text);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated;
    grant select on profiles to authenticated;
  `);
  const sql=readFileSync(new URL('../supabase/migrations/055_profile_avatars.sql',import.meta.url),'utf8');
  await db.exec(sql); await db.exec(sql);
},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec('reset role; truncate profiles,storage.objects');
  await db.query('insert into profiles(id) values($1),($2)',[first,second]);
  await db.query("select set_config('test.user',$1,false)",[first]);
  await db.exec('set role authenticated');
});
const upload = (path, size=10000, mime='image/webp') => db.query("insert into storage.objects(bucket_id,name,metadata) values('profile-avatars',$1,$2::jsonb) on conflict(bucket_id,name) do update set metadata=excluded.metadata",[path,JSON.stringify({size,mimetype:mime})]);
describe('avatar storage permissions and RPC',()=>{
  it('allows one own object and replacement without accumulating files',async()=>{
    await upload(`${first}/avatar`); await upload(`${first}/avatar`,12000);
    expect((await db.query('select count(*)::int n from storage.objects')).rows[0].n).toBe(1);
    await db.query('select set_own_profile_avatar($1)',[version]);
    expect((await db.query('select avatar_url from profiles where id=$1',[first])).rows[0].avatar_url).toBe(`${first}/avatar?v=${version}`);
    expect((await db.query('select avatar_url from profiles where id=$1',[second])).rows[0].avatar_url).toBeNull();
    await db.query('select set_own_profile_avatar(null)');
    await db.query('delete from storage.objects where name=$1',[`${first}/avatar`]);
    expect((await db.query('select count(*)::int n from storage.objects')).rows[0].n).toBe(0);
  });
  it('rejects writing another user folder or additional filenames',async()=>{
    await expect(upload(`${second}/avatar`)).rejects.toThrow();
    await expect(upload(`${first}/other-photo`)).rejects.toThrow();
    await upload(`${first}/avatar`);
    await db.query("select set_config('test.user',$1,false)",[second]);
    expect((await db.query('delete from storage.objects where name=$1 returning id',[`${first}/avatar`])).rows).toHaveLength(0);
    expect((await db.query('update storage.objects set metadata=$1::jsonb where name=$2 returning id',['{}',`${first}/avatar`])).rows).toHaveLength(0);
  });
  it('requires a valid uploaded object and rejects unauthenticated profile writes',async()=>{
    await expect(db.query('select set_own_profile_avatar($1)',[version])).rejects.toThrow('50KB');
    await upload(`${first}/avatar`,60000);
    await expect(db.query('select set_own_profile_avatar($1)',[version])).rejects.toThrow('50KB');
    await upload(`${first}/avatar`,1000,'image/svg+xml');
    await expect(db.query('select set_own_profile_avatar($1)',[version])).rejects.toThrow('50KB');
    await db.query("select set_config('test.user','',false)");
    await expect(db.query('select set_own_profile_avatar(null)')).rejects.toThrow('להתחבר');
  });
  it('configures the Storage API limit and format whitelist',async()=>{
    await db.exec('reset role');
    const bucket=(await db.query("select * from storage.buckets where id='profile-avatars'")).rows[0];
    expect(Number(bucket.file_size_limit)).toBe(51200);
    expect(bucket.allowed_mime_types).toEqual(['image/webp','image/jpeg']);
  });
});
