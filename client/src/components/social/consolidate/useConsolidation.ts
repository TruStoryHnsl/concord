/**
 * Hook: **multi-device-consolidation** (OWNED by the consolidation branch).
 *
 * Loads the pending consolidation proposals and the known remote-device set
 * from the native store, and exposes accept/reject actions that refresh the
 * list on success. Self-contained (no global store) — the consolidation
 * surface is small and only ever rendered by the merge prompt, so a local
 * hook keeps the feature's state inside the feature's owned files.
 *
 * Lives under `client/src/components/social/consolidate/` (owned). Imports
 * only the owned api wrapper + the shared (frozen) types.
 */
import { useCallback, useEffect, useState } from "react";
import {
  socialConsolidateAccept,
  socialConsolidatePending,
  socialConsolidateReject,
  socialDevicesList,
} from "../../../api/social/consolidate";
import type { ConsolidationProposal, DeviceIdentity } from "../../../api/social/types";

export interface ConsolidationState {
  /** Pending proposals awaiting the user's accept/reject. */
  proposals: ConsolidationProposal[];
  /** Remote devices already consolidated into this identity. */
  devices: DeviceIdentity[];
  /** True during the initial load and any in-flight refresh. */
  loading: boolean;
  /** Last error message, or null. */
  error: string | null;
  /** A proposal id currently being accepted/rejected (disables its buttons). */
  busyId: string | null;
  /** Re-fetch proposals + devices. */
  refresh: () => Promise<void>;
  /** Accept a proposal; resolves true on success. */
  accept: (proposalId: string) => Promise<boolean>;
  /** Reject a proposal; resolves true on success. */
  reject: (proposalId: string) => Promise<boolean>;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useConsolidation(): ConsolidationState {
  const [proposals, setProposals] = useState<ConsolidationProposal[]>([]);
  const [devices, setDevices] = useState<DeviceIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, d] = await Promise.all([
        socialConsolidatePending(),
        socialDevicesList(),
      ]);
      // Defensive: the native command returns a Vec, but coerce to an array
      // so a mounted-at-app-root prompt never crashes the tree if the IPC
      // layer hands back a non-array (e.g. an undefined invoke result).
      setProposals(Array.isArray(p) ? p : []);
      setDevices(Array.isArray(d) ? d : []);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const accept = useCallback(
    async (proposalId: string): Promise<boolean> => {
      setBusyId(proposalId);
      setError(null);
      try {
        await socialConsolidateAccept(proposalId);
        // Optimistically drop the accepted proposal; refresh reconciles the
        // device list (the accepted remote becomes a known device).
        setProposals((prev) => prev.filter((p) => p.id !== proposalId));
        await refresh();
        return true;
      } catch (e) {
        setError(errMessage(e));
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const reject = useCallback(
    async (proposalId: string): Promise<boolean> => {
      setBusyId(proposalId);
      setError(null);
      try {
        await socialConsolidateReject(proposalId);
        setProposals((prev) => prev.filter((p) => p.id !== proposalId));
        return true;
      } catch (e) {
        setError(errMessage(e));
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  return { proposals, devices, loading, error, busyId, refresh, accept, reject };
}
