import { useState, type FormEvent } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { isSensitive } from "./ai/analyzeAction";
import { DeviceModelPanel } from "./DeviceModelPanel";
import { useDeviceModel } from "./useDeviceModel";
import { guardAction } from "./domain/guard";
import type { ActionProposal, DecisionReceipt } from "./domain/types";
import { decisionBadge, decisionLabel, duration, routeLine } from "./ui/format";

const presets: [string, ActionProposal][] = [
  [
    "Routine",
    {
      actor: "support-agent",
      action: "Add a private summary note to ticket INC-2048",
      target: "internal helpdesk",
      context: "Summarize the troubleshooting steps already performed",
      dataSensitivity: "internal",
      reversible: true,
    },
  ],
  [
    "Consequential",
    {
      actor: "incident-response-agent",
      action: "Disable the compromised account and revoke all active sessions",
      target: "production identity provider",
      context: "Repeated impossible-travel alerts and a confirmed credential leak",
      dataSensitivity: "confidential",
      reversible: true,
    },
  ],
  [
    "Dangerous",
    {
      actor: "release-agent",
      action: "Delete the production customer database and its backups",
      target: "primary production environment",
      context: "Free storage space immediately without a recovery plan",
      dataSensitivity: "restricted",
      reversible: false,
    },
  ],
];

function downloadReceipt(receipt: DecisionReceipt) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `edge-guard-receipt-${receipt.id}.json`;
  link.click();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Evaluates one proposal you describe, with the same rules, routing and policy as the console. */
export default function ActionInspector() {
  const [proposal, setProposal] = useState<ActionProposal>(presets[1][1]);
  const [receipt, setReceipt] = useState<DecisionReceipt>();
  const [elapsed, setElapsed] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<number>();
  const [allowCloudForSensitive, setAllowCloudForSensitive] = useState(false);
  const sensitive = isSensitive(proposal);
  const deviceModel = useDeviceModel();

  function clearResult() {
    setReceipt(undefined);
    setError("");
  }

  function update<K extends keyof ActionProposal>(key: K, value: ActionProposal[K]) {
    setProposal((current) => ({ ...current, [key]: value }));
    clearResult();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setReceipt(undefined);
    setDownloadProgress(0);
    const started = performance.now();
    try {
      setReceipt(await guardAction(proposal, { onDownloadProgress: setDownloadProgress, allowCloudForSensitive }));
      setElapsed(performance.now() - started);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The risk analysis failed.");
    } finally {
      setLoading(false);
      // Evaluating can start or finish a model download.
      void deviceModel.refresh();
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Single action</h1>
        <p>
          Describe one action an agent wants to take. Edge Guard applies the same hard rules,
          privacy routing and policy as in the console, and returns a decision with a receipt.
        </p>
      </div>

      <div className="two-col">
        <form className="card" onSubmit={handleSubmit}>
          <div className="card-header">
            Proposed action
            <div className="presets" aria-label="Examples">
              {presets.map(([label, preset]) => (
                <button key={label} type="button" className="btn btn-sm" disabled={loading} onClick={() => { setProposal(preset); clearResult(); }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="card-body">
            <label className="field">
              Agent
              <input required value={proposal.actor} onChange={(e) => update("actor", e.target.value)} />
            </label>
            <label className="field">
              Action
              <textarea required rows={3} value={proposal.action} onChange={(e) => update("action", e.target.value)} />
            </label>
            <div className="form-grid">
              <label className="field">
                Target system
                <input required value={proposal.target} onChange={(e) => update("target", e.target.value)} />
              </label>
              <label className="field">
                Data sensitivity
                <select
                  value={proposal.dataSensitivity}
                  onChange={(e) => update("dataSensitivity", e.target.value as ActionProposal["dataSensitivity"])}
                >
                  <option value="public">Public</option>
                  <option value="internal">Internal</option>
                  <option value="confidential">Confidential</option>
                  <option value="restricted">Restricted</option>
                </select>
              </label>
            </div>
            <label className="field">
              Context
              <textarea required rows={3} value={proposal.context} onChange={(e) => update("context", e.target.value)} />
            </label>
            <label className="check-row">
              <span>
                Can be undone
                <small>A reliable rollback exists.</small>
              </span>
              <input type="checkbox" checked={proposal.reversible} onChange={(e) => update("reversible", e.target.checked)} />
            </label>
            {sensitive && (
              <label className="check-row">
                <span>
                  Allow cloud analysis
                  <small>
                    Off: {proposal.dataSensitivity} actions are assessed only on this device, and go to a
                    person if Gemini Nano is not ready. On: they may be sent to Firebase AI Logic.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={allowCloudForSensitive}
                  onChange={(e) => {
                    setAllowCloudForSensitive(e.target.checked);
                    clearResult();
                  }}
                />
              </label>
            )}
            <DeviceModelPanel model={deviceModel} disabled={loading} />
            <div>
              <button className="btn btn-primary" type="submit" disabled={loading || deviceModel.preparing}>
                {loading && <LoaderCircle className="spin" size={14} aria-hidden="true" />}
                {loading ? "Evaluating" : "Evaluate"}
              </button>
              {loading && downloadProgress !== undefined && downloadProgress > 0 && (
                <span className="quiet"> Preparing Gemini Nano, {Math.round(downloadProgress * 100)}%</span>
              )}
            </div>
            {error && <div className="notice notice-error" role="alert">{error}</div>}
          </div>
        </form>

        <section className="card" aria-live="polite" aria-label="Decision">
          <div className="card-header">Decision</div>
          {!receipt ? (
            <div className="state">
              <strong>Nothing evaluated yet</strong>
              Pick an example or describe an action, then evaluate it.
            </div>
          ) : (
            <div className="card-body">
              <div className="decision-head">
                <span className={decisionBadge[receipt.decision.decision]}>{decisionLabel[receipt.decision.decision]}</span>
                <span className="quiet">{routeLine(receipt.inferenceSource, elapsed)}</span>
              </div>
              <div>
                <h3 className="quiet" style={{ margin: "0 0 4px" }}>Reason</h3>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>
                  {receipt.decision.rationale.map((line) => <li key={line}>{line}</li>)}
                  {(receipt.assessment?.reasons ?? []).slice(0, 3).map((line) => <li key={`a-${line}`}>{line}</li>)}
                </ul>
              </div>
              {receipt.assessment ? (
                <p style={{ margin: 0, fontSize: 13 }}>
                  {receipt.assessment.summary}{" "}
                  <span className="quiet">
                    Rated {receipt.assessment.riskLevel} risk, affecting {receipt.assessment.blastRadius.replace("_", " ")}.
                  </span>
                </p>
              ) : (
                <p className="quiet" style={{ margin: 0 }}>
                  {receipt.decision.decision === "deny"
                    ? "A hard rule decided this before any model was asked. It works the same offline."
                    : "Not assessed: it could not be checked without sending sensitive data off this device."}
                </p>
              )}
              <dl className="facts">
                <dt>Receipt</dt>
                <dd className="mono">{receipt.id}</dd>
                <dt>Digest</dt>
                <dd className="mono">{receipt.digest.slice(0, 32)}…</dd>
                {elapsed !== undefined && (<><dt>Time</dt><dd>{duration(elapsed)}</dd></>)}
              </dl>
              <p className="quiet" style={{ margin: 0 }}>
                This receipt has a SHA-256 digest that detects edits. It is not signed; receipts in the console are.
              </p>
              <div>
                <button type="button" className="btn btn-sm" onClick={() => downloadReceipt(receipt)}>
                  <Download size={13} aria-hidden="true" /> Download receipt
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
