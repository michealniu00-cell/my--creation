'use client';

import { useEffect, useState } from 'react';

export interface StreamMessage {
  event: string;
  data: Record<string, unknown>;
}

export function useRunStream(runId?: string | null) {
  const [messages, setMessages] = useState<StreamMessage[]>([]);

  useEffect(() => {
    if (!runId) {
      return;
    }

    const source = new EventSource(`/api/stream/runs/${runId}`);

    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as StreamMessage;
        setMessages((current) => [...current.slice(-8), parsed]);
      } catch {
        setMessages((current) => [...current.slice(-8), { event: 'message', data: { raw: event.data } }]);
      }
    };

    return () => {
      source.close();
    };
  }, [runId]);

  return messages;
}

