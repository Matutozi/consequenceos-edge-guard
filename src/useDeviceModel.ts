import { useCallback, useEffect, useState } from "react";
import {
  getDeviceModelStatus,
  prepareDeviceModel,
  warmDeviceModel,
  type DeviceModelStatus,
} from "./ai/analyzeAction";

export interface DeviceModel {
  status?: DeviceModelStatus;
  preparing: boolean;
  progress: number;
  error: string;
  /** Starts the download. Call from a click: Chrome requires a user gesture. */
  prepare: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useDeviceModel(): DeviceModel {
  const [status, setStatus] = useState<DeviceModelStatus>();
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const next = await getDeviceModelStatus();
    setStatus(next);
    // Load the model into memory now, so the first check does not pay for it.
    if (next === "available") void warmDeviceModel();
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const prepare = useCallback(async () => {
    setPreparing(true);
    setError("");
    setProgress(0);
    try {
      await prepareDeviceModel(setProgress);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The on-device model could not be prepared.");
    } finally {
      setPreparing(false);
      await refresh();
    }
  }, [refresh]);

  return { status, preparing, progress, error, prepare, refresh };
}
