"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

let browserClient: ReturnType<typeof createClient> | null = null;

function getBrowserClient() {
  if (!browserClient) {
    browserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
    );
  }
  return browserClient;
}

export interface RealtimeMessage {
  type: string;
  [key: string]: unknown;
}

/** Subscribes to one topic (see topic() in src/server/realtime.ts) for the component's lifetime. */
export function useChannel(topicName: string, onMessage: (msg: RealtimeMessage) => void): void {
  const handlerRef = useRef(onMessage);
  // Sync post-render (not during render) so the effect below can always call the latest handler
  // without needing to resubscribe the channel every time the caller passes a new function.
  useEffect(() => {
    handlerRef.current = onMessage;
  });

  useEffect(() => {
    const client = getBrowserClient();
    const channel = client.channel(topicName);
    channel.on("broadcast", { event: "update" }, ({ payload }) => {
      handlerRef.current(payload as RealtimeMessage);
    });
    channel.subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [topicName]);
}
