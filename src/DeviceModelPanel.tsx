import { Download, LoaderCircle } from "lucide-react";
import type { DeviceModel } from "./useDeviceModel";

/** One quiet line on Gemini Nano's state, with a download control where Chrome offers one. */
export function DeviceModelPanel({ model, disabled = false }: { model: DeviceModel; disabled?: boolean }) {
  const { status, preparing, progress, error } = model;
  const percent = Math.round(progress * 100);
  const canPrepare = status === "downloadable" || status === "downloading";

  const text = preparing
    ? `Downloading Gemini Nano, ${percent}%`
    : status === undefined
      ? "Checking for Gemini Nano"
      : status === "available"
        ? "Gemini Nano is ready on this device"
        : canPrepare
          ? status === "downloading"
            ? "Gemini Nano is downloading"
            : "Gemini Nano is not downloaded. Until it is, public and internal checks use the cloud"
          : status === "unsupported"
            ? "This browser has no on-device model. Public and internal checks use the cloud; sensitive ones go to a person"
            : "Gemini Nano can't run on this device. Public and internal checks use the cloud; sensitive ones go to a person";

  return (
    <div className="model-status" aria-live="polite">
      {preparing && <LoaderCircle className="spin" size={13} aria-hidden="true" />}
      <span>{text}</span>
      {canPrepare && !preparing && (
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => void model.prepare()}>
          <Download size={13} aria-hidden="true" /> {status === "downloading" ? "Show progress" : "Download model"}
        </button>
      )}
      {preparing && (
        <span className="progress" role="progressbar" aria-label="Gemini Nano download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{ width: `${percent}%` }} />
        </span>
      )}
      {error && <span className="text-deny" role="alert">{error}</span>}
    </div>
  );
}
