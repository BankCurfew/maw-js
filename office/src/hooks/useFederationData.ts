import { useState, useEffect, useCallback, useRef } from "react";
import { apiUrl } from "../lib/api";
import type {
  FederationConfig,
  FederationStatus,
  FederatedAgent,
  PeerStatus,
} from "../lib/federation";

interface UseFederationData {
  /** Current node name (null until loaded) */
  localNode: string | null;
  /** All agents across all nodes */
  agents: FederatedAgent[];
  /** Peer reachability status (smoothed — requires 3 consecutive failures) */
  peers: PeerStatus[];
  /** Whether federation data is loading */
  loading: boolean;
  /** Whether federation is available (API responded) */
  available: boolean;
  /** Re-fetch all federation data */
  refresh: () => void;
}

const POLL_INTERVAL = 30_000; // refresh peer status every 30s
const FAIL_THRESHOLD = 3; // consecutive failures before marking offline

export function useFederationData(): UseFederationData {
  const [config, setConfig] = useState<FederationConfig | null>(null);
  const [peers, setPeers] = useState<PeerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);
  // Track consecutive unreachable counts per peer URL
  const failCounts = useRef<Record<string, number>>({});

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/config"));
      if (!res.ok) throw new Error(`${res.status}`);
      const data: FederationConfig = await res.json();
      if (data.node && data.agents) {
        setConfig(data);
        setAvailable(true);
      }
    } catch {
      // Federation API not available yet (#10 not deployed)
      setAvailable(false);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/federation/status"));
      if (!res.ok) return;
      const data: FederationStatus = await res.json();
      const raw = data.peers ?? [];
      // Smooth reachability: require FAIL_THRESHOLD consecutive failures
      const smoothed = raw.map(p => {
        const key = p.url;
        if (p.reachable) {
          failCounts.current[key] = 0;
          return p;
        }
        failCounts.current[key] = (failCounts.current[key] || 0) + 1;
        // Keep showing as reachable until threshold hit
        if (failCounts.current[key] < FAIL_THRESHOLD) {
          return { ...p, reachable: true };
        }
        return p;
      });
      setPeers(smoothed);
    } catch {
      // Silently fail — status is optional
    }
  }, []);

  const refresh = useCallback(() => {
    fetchConfig();
    fetchStatus();
  }, [fetchConfig, fetchStatus]);

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchConfig();
      await fetchStatus();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [fetchConfig, fetchStatus]);

  // Poll peer status
  useEffect(() => {
    if (!available) return;
    const id = setInterval(fetchStatus, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [available, fetchStatus]);

  // Derive agent list from config
  const agents: FederatedAgent[] = config
    ? Object.entries(config.agents).map(([name, node]) => ({
        name,
        node,
        isLocal: node === config.node,
      }))
    : [];

  return {
    localNode: config?.node ?? null,
    agents,
    peers,
    loading,
    available,
    refresh,
  };
}
