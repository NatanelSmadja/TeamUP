import {afterEach,describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import PlayerAvatar from '../components/PlayerAvatar';
import {avatarUrl} from './avatarUrl';
import {MAX_AVATAR_SOURCE_BYTES,validateAvatarSource} from './avatarCompression';

afterEach(() => vi.unstubAllEnvs());
describe('profile avatars', () => {
  it('rejects oversized, empty and disguised non-image files before decoding', async () => {
    await expect(validateAvatarSource(new File(['<svg/>'],'fake.png',{type:'image/png'}))).rejects.toThrow('JPG');
    await expect(validateAvatarSource(new File([],'empty.jpg'))).rejects.toThrow('10MB');
    await expect(validateAvatarSource(new File([new Uint8Array(MAX_AVATAR_SOURCE_BYTES+1)],'large.jpg'))).rejects.toThrow('10MB');
  });
  it('only resolves known storage paths and existing secure image URLs', () => {
    vi.stubEnv('VITE_SUPABASE_URL','https://example.supabase.co');
    const path='00000000-0000-0000-0000-000000000001/avatar?v=00000000-0000-0000-0000-000000000002';
    expect(avatarUrl(path)).toBe(`https://example.supabase.co/storage/v1/object/public/profile-avatars/${path}`);
    expect(avatarUrl('javascript:alert(1)')).toBeUndefined();
    expect(avatarUrl('../other/file')).toBeUndefined();
    expect(avatarUrl('https://example.com/photo.jpg')).toBe('https://example.com/photo.jpg');
  });
  it('renders a photo when available and an initial for guests or missing images', () => {
    expect(renderToStaticMarkup(<PlayerAvatar profile={{first_name:'אור',avatar_url:'https://example.com/photo.jpg'}}/>)).toContain('<img');
    const guest=renderToStaticMarkup(<PlayerAvatar name="אורח"/>);
    expect(guest).not.toContain('<img'); expect(guest).toContain('א');
  });
});
