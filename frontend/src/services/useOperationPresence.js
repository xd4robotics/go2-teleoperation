import { useEffect, useState } from "react";

import { supabase } from "../lib/supabase";
import {
  OPERATION_PRESENCE_CHANNEL,
  usersFromPresenceState,
} from "./operationPresence";

export function useOperationPresence(user, enabled = true) {
  const userId = user?.id;
  const email = user?.email;
  const [presence, setPresence] = useState({ userId: null, users: [] });

  useEffect(() => {
    if (!enabled || !supabase || !userId) return undefined;

    let isActive = true;
    let channel = null;

    async function connectPresence() {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();

      if (error) throw error;
      if (!isActive) return;

      const username = email?.split("@")[0]?.slice(0, 5) || "user";
      channel = supabase.channel(OPERATION_PRESENCE_CHANNEL, {
        config: { presence: { key: userId } },
      });

      channel
        .on("presence", { event: "sync" }, () => {
          if (!isActive) return;
          setPresence({
            userId,
            users: usersFromPresenceState(channel.presenceState()),
          });
        })
        .subscribe(async (status) => {
          if (!isActive || status !== "SUBSCRIBED") return;
          await channel.track({
            user_id: userId,
            username,
            role: profile.role,
          });
        });
    }

    connectPresence().catch((error) => {
      if (isActive) {
        console.warn("Não foi possível iniciar a presença do dashboard.", error);
      }
    });

    return () => {
      isActive = false;
      if (!channel) return;
      void channel.untrack();
      void supabase.removeChannel(channel);
    };
  }, [email, enabled, userId]);

  return presence.userId === userId ? presence.users : [];
}
