import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ResourceUsageDetails} from '../components/SystemResourceUsage';
import {formatBytes, usageLevel} from './resourceUsage';

describe('resource usage warnings', () => {
  it('warns at 80% and escalates at 95%, including over quota', () => {
    expect(usageLevel(79,100)).toBe('normal');
    expect(usageLevel(80,100)).toBe('warning');
    expect(usageLevel(95,100)).toBe('danger');
    expect(usageLevel(150,100)).toBe('danger');
    expect(formatBytes(500_000_000)).toBe('500 MB');
  });
  it('does not report remaining storage when some object sizes are unknown', () => {
    const html = renderToStaticMarkup(<ResourceUsageDetails data={{measured_at:'2026-09-25T10:00:00Z', database_bytes:550_000_000,
      buckets:[{id:'profile-avatars',bytes:12000,file_count:2,unknown_size_count:1}]}}/>);
    expect(html).toContain('לא ניתן לחשב יתרה');
    expect(html).toContain('נחצתה');
    expect(html).not.toContain('נותרו להשוואה');
  });
});
