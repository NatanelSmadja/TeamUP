import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

function createChannelId(baseName: string) {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${baseName}-${suffix}`;
}

export function useRealtimeInvalidation(
  channelName: string,
  tables: string[],
  queryKeys: (readonly unknown[])[],
  enabled = true,
) {
  const queryClient = useQueryClient();
  const tablesKey = JSON.stringify(tables);
  const queryKeysKey = JSON.stringify(queryKeys);

  useEffect(() => {
    if (!enabled || tables.length === 0) return;

    let disposed = false;
    const channel = supabase.channel(createChannelId(`realtime-${channelName}`));

    // Supabase requires every callback to be registered before subscribe().
    tables.forEach((table) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          if (disposed) return;
          queryKeys.forEach((queryKey) => {
            void queryClient.invalidateQueries({ queryKey });
          });
        },
      );
    });

    channel.subscribe();

    return () => {
      disposed = true;
      void channel.unsubscribe().finally(() => {
        void supabase.removeChannel(channel);
      });
    };
    // Stable serialized keys prevent needless reconnects while still reacting
    // when the requested tables or query keys genuinely change.
  }, [channelName, enabled, queryClient, tablesKey, queryKeysKey]);
}
