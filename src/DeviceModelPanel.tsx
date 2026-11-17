import { Cloud, Cpu, Download, LoaderCircle } from "lucide-react";
import type { DeviceModel } from "./useDeviceModel";

interface DeviceModelPanelProps {
  model: DeviceModel;
  disabled?: boolean;
  compact?: boolean;
}

export function DeviceModelPanel({ model, disabled = false, compact = false }: DeviceModelPanelProps) {
  const { status, preparing, progress, error } = model;
  const noLocalModel = status === "unsupported" || status === "unavailable";
  const canPrepare = status === "downloadable" || status === "downloading";
  const percent = Math.round(progress * 100);

  let title: string;
  let detail: string;
  if (preparing) {
    title = `Downloading Gemini Nano · ${percent}%`;
    detail = "Chrome downloads the model once. Public and internal actions can use the cloud meanwhile.";
  } else if (status === undefined) {
    title = "Checking on-device model…";
    detail = "Looking for Gemini Nano in this browser.";
  } else if (status === "available") {
    title = "Gemini Nano ready";
    detail = "Actions are assessed privately on this device first.";
  } else if (canPrepare) {
    title = status === "downloading" ? "Gemini Nano is downloading" : "Gemini Nano not downloaded";
    detail =
      "Download it once to assess actions on this device. Until then, public and internal actions use the cloud.";
  } else {
    title =
      status === "unsupported" ? "No on-device model in this browser" : "Gemini Nano can't run on this device";
    detail =
      "Public and internal actions use Firebase AI Logic in the cloud. Sensitive actions never leave the device: they go to a human.";
  }

  return (
    <div
      className={`model-panel ${status === "available" ? "ready" : ""} ${compact ? "compact" : ""}`}
      aria-live="polite"
    >
      <span className="model-icon">
        {preparing ? (
          <LoaderCircle className="spin" size={16} />
        ) : noLocalModel ? (
          <Cloud size={16} />
        ) : (
          <Cpu size={16} />
        )}
      </span>
      <span className="model-text">
        <strong>{title}</strong>
        <small>{detail}</small>
        {preparing && (
          <span
            className="model-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={{ width: `${percent}%` }} />
          </span>
        )}
        {error && (
          <small className="model-error" role="alert">
            {error}
          </small>
        )}
      </span>
      {canPrepare && !preparing && (
        <button type="button" disabled={disabled} onClick={() => void model.prepare()}>
          <Download size={14} /> {status === "downloading" ? "Track" : "Download"}
        </button>
      )}
    </div>
  );
}
