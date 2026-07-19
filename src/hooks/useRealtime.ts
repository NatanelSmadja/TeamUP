import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useRealtimeInvalidation(
  channelName: string,
  tables: string[],
  queryKeys: (readonly unknown[])[],
  enabled = true,
) {
  const queryClient = useQueryClient();
  const tablesKey = useMemo(() => JSON.stringify(tables), [tables]);
  const queryKeysKey = useMemo(() => JSON.stringify(queryKeys), [queryKeys]);

  useEffect(() => {
    if (!enabled) return undefined;

    // A unique topic prevents React StrictMode from reusing a channel that is
    // still being removed after the first development-only mount.
    const uniqueTopic = `${channelName}-${crypto.randomUUID()}`;
    const channel = supabase.channel(uniqueTopic);

    for (const table of tables) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          for (const queryKey of queryKeys) {
            void queryClient.invalidateQueries({ queryKey });
          }
        },
      );
    }

    channel.subscribe();

    return () => {
      void channel.unsubscribe().finally(() => {
        void supabase.removeChannel(channel);
      });
    };
  }, [channelName, enabled, queryClient, tablesKey, queryKeysKey]);
}
