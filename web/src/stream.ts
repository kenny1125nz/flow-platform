import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { StreamEvent } from '@shared/api-types';

export function useLiveEvents(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource('/api/events');

    source.onmessage = (event) => {
      if (!event.data || event.data === '{}') {
        return;
      }

      let parsed: StreamEvent;
      try {
        parsed = JSON.parse(event.data) as StreamEvent;
      } catch {
        return;
      }

      if (parsed.type === 'run') {
        void queryClient.invalidateQueries({ queryKey: ['board'] });
        void queryClient.invalidateQueries({ queryKey: ['runs'] });
        void queryClient.invalidateQueries({ queryKey: ['run', parsed.run.runId] });
        void queryClient.invalidateQueries({ queryKey: ['flow-runs'] });
        void queryClient.invalidateQueries({ queryKey: ['plan-runs'] });
      }
    };

    source.onerror = () => {
      // EventSource reconnects automatically.
    };

    return () => source.close();
  }, [queryClient]);
}
