import { useEffect, useState } from "react";
import { useAuthStore } from "../stores/auth";
import { getUsersWithTOTP } from "../api/concord";

// Cache the result globally to avoid repeated fetches across components
let cachedSet: Set<string> = new Set();
let lastFetch = 0;
const CACHE_TTL = 60_000; // 1 minute

export function useTOTPUsers(): Set<string> {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [users, setUsers] = useState(cachedSet);

  useEffect(() => {
    if (!accessToken) return;
    if (Date.now() - lastFetch < CACHE_TTL && cachedSet.size > 0) return;

    getUsersWithTOTP(accessToken)
      .then((res) => {
        cachedSet = new Set(res.user_ids);
        lastFetch = Date.now();
        setUsers(cachedSet);
      })
      .catch(() => {});
  }, [accessToken]);

  return users;
}
