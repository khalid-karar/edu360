"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";

/** Loads a GET endpoint and lets the caller reload it after an action. */
export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) {
      setData(null);
      return;
    }
    let live = true;
    setErr(null);
    api<T>("GET", path)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [path, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, err, reload };
}

/** Runs a POST/PATCH, tracks busy and error state. */
export function useAct() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const run = useCallback(async (method: "POST" | "PATCH", path: string, body?: unknown) => {
    setBusy(true);
    setErr(null);
    try {
      return await api(method, path, body ?? {});
    } catch (e) {
      setErr(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, err, run, clear: () => setErr(null) };
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; count?: number }[] }) {
  return (
    <div className="tabs" role="group">
      {items.map((i) => (
        <button key={i.id} type="button" aria-pressed={value === i.id} onClick={() => onChange(i.id)}>
          {i.label}{i.count !== undefined ? ` (${i.count})` : ""}
        </button>
      ))}
    </div>
  );
}
