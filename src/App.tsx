import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  Cloud,
  Cpu,
  Download,
  Fingerprint,
  LoaderCircle,
  LockKeyhole,
  OctagonX,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { analyzeAction, isSensitive } from "./ai/analyzeAction";
import { evaluatePolicy } from "./domain/policy";
import { createDecisionReceipt } from "./domain/receipt";
import type {
  ActionProposal,
  DecisionReceipt,
  PolicyDecision,
} from "./domain/types";

const initialProposal: ActionProposal = {
  actor: "incident-response-agent",
  action: "Disable the compromised account and revoke all active sessions",
  target: "production identity provider",
  context: "Repeated impossible-travel alerts and a confirmed credential leak",
  dataSensitivity: "confidential",
  reversible: true,
};

const routineProposal: ActionProposal = {
  actor: "support-agent",
  action: "Add a private summary note to ticket INC-2048",
  target: "internal helpdesk",
  context: "Summarize the troubleshooting steps already performed",
  dataSensitivity: "internal",
  reversible: true,
};

const dangerousProposal: ActionProposal = {
  actor: "release-agent",
  action: "Delete the production customer database and its backups",
  target: "primary production environment",
  context: "Free storage space immediately without a recovery plan",
  dataSensitivity: "restricted",
  reversible: false,
};

const decisionMeta: Record<
  PolicyDecision,
  { label: string; icon: typeof Check; tone: string }
> = {
  allow: { label: "Proceed automatically", icon: Check, tone: "allow" },
  require_approval: {
    label: "Human approval required",
    icon: TriangleAlert,
    tone: "review",
  },
  deny: { label: "Action blocked", icon: OctagonX, tone: "deny" },
};

function downloadReceipt(receipt: DecisionReceipt) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `edge-guard-receipt-${receipt.id}.json`;
  link.click();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function App() {
  const [proposal, setProposal] = useState<ActionProposal>(initialProposal);
  const [receipt, setReceipt] = useState<DecisionReceipt>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<number>();
  const [allowCloudForSensitive, setAllowCloudForSensitive] = useState(false);
  const sensitive = isSensitive(proposal);

  const sourceLabel = useMemo(() => {
    if (!receipt) return "Awaiting analysis";
    return receipt.inferenceSource === "ON_DEVICE"
      ? "Gemini Nano · on device"
      : receipt.inferenceSource === "IN_CLOUD"
        ? "Firebase AI Logic · cloud fallback"
        : "Firebase AI Logic · source unavailable";
  }, [receipt]);

  function clearResult() {
    setReceipt(undefined);
    setError("");
  }

  function update<K extends keyof ActionProposal>(key: K, value: ActionProposal[K]) {
    setProposal((current) => ({ ...current, [key]: value }));
    clearResult();
  }

  function loadPreset(preset: ActionProposal) {
    setProposal(preset);
    clearResult();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setReceipt(undefined);
    setDownloadProgress(0);

    try {
      const analysis = await analyzeAction(proposal, {
        onDownloadProgress: setDownloadProgress,
        allowCloudForSensitive,
      });
      const decision = evaluatePolicy(proposal, analysis.assessment);
      setReceipt(await createDecisionReceipt(proposal, analysis, decision));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The risk analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  const meta = receipt ? decisionMeta[receipt.decision.decision] : undefined;
  const DecisionIcon = meta?.icon;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="ConsequenceOS Edge Guard home">
          <span className="brand-mark"><ShieldCheck size={19} /></span>
          <span>Consequence<span>OS</span></span>
          <span className="product-tag">EDGE GUARD</span>
        </a>
        <div className="privacy-status">
          <span className="pulse" />
          Privacy-first hybrid inference
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="eyebrow"><Sparkles size={14} /> Execution control for AI agents</div>
          <h1>Know the consequence<br />before the action.</h1>
          <p>
            Edge Guard evaluates proposed agent actions locally when possible, falls
            back safely when necessary, and applies deterministic policy before execution.
          </p>
          <div className="trust-row">
            <span><Cpu size={16} /> On-device first</span>
            <span><Cloud size={16} /> Cloud fallback</span>
            <span><Fingerprint size={16} /> Integrity-digest receipt</span>
          </div>
        </section>

        <section className="workspace" aria-label="Action analysis workspace">
          <form className="proposal-card" onSubmit={handleSubmit}>
            <div className="card-heading">
              <div>
                <span className="step-label">01 · PROPOSE</span>
                <h2>Describe the agent action</h2>
              </div>
              <LockKeyhole size={20} />
            </div>

            <div className="presets" aria-label="Example actions">
              <button type="button" disabled={loading} onClick={() => loadPreset(routineProposal)}>Routine</button>
              <button type="button" disabled={loading} onClick={() => loadPreset(initialProposal)}>Consequential</button>
              <button type="button" disabled={loading} onClick={() => loadPreset(dangerousProposal)}>Dangerous</button>
            </div>

            <label>
              Agent identity
              <input
                required
                value={proposal.actor}
                onChange={(event) => update("actor", event.target.value)}
              />
            </label>

            <label>
              Proposed action
              <textarea
                required
                rows={3}
                value={proposal.action}
                onChange={(event) => update("action", event.target.value)}
              />
            </label>

            <div className="field-grid">
              <label>
                Target system
                <input
                  required
                  value={proposal.target}
                  onChange={(event) => update("target", event.target.value)}
                />
              </label>
              <label>
                Data sensitivity
                <select
                  value={proposal.dataSensitivity}
                  onChange={(event) =>
                    update("dataSensitivity", event.target.value as ActionProposal["dataSensitivity"])
                  }
                >
                  <option value="public">Public</option>
                  <option value="internal">Internal</option>
                  <option value="confidential">Confidential</option>
                  <option value="restricted">Restricted</option>
                </select>
              </label>
            </div>

            <label>
              Operational context
              <textarea
                required
                rows={3}
                value={proposal.context}
                onChange={(event) => update("context", event.target.value)}
              />
            </label>

            <label className="toggle-row">
              <span>
                <strong>Action is reversible</strong>
                <small>A reliable rollback procedure exists.</small>
              </span>
              <input
                type="checkbox"
                checked={proposal.reversible}
                onChange={(event) => update("reversible", event.target.checked)}
              />
            </label>

            {sensitive && (
              <label className="toggle-row">
                <span>
                  <strong>Allow cloud analysis</strong>
                  <small>
                    Off: {proposal.dataSensitivity} proposals are analyzed only on this
                    device. On: they may be sent to Firebase AI Logic if Gemini Nano is
                    unavailable.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={allowCloudForSensitive}
                  onChange={(event) => {
                    setAllowCloudForSensitive(event.target.checked);
                    clearResult();
                  }}
                />
              </label>
            )}

            <button className="analyze-button" disabled={loading} type="submit">
              {loading ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}
              {loading ? "Evaluating consequence…" : "Evaluate before execution"}
              {!loading && <ArrowRight size={18} />}
            </button>

            {loading && downloadProgress !== undefined && downloadProgress > 0 && (
              <p className="progress-note">
                Preparing on-device model · {Math.round(downloadProgress * 100)}%
              </p>
            )}
            {error && <div className="error-message" role="alert">{error}</div>}
          </form>

          <article className={`decision-card ${meta?.tone ?? "idle"}`} aria-live="polite">
            <div className="card-heading">
              <div>
                <span className="step-label">02 · DECIDE</span>
                <h2>Execution decision</h2>
              </div>
              <span className="source-badge">
                {receipt?.inferenceSource === "ON_DEVICE" ? <Cpu size={14} /> : <Cloud size={14} />}
                {sourceLabel}
              </span>
            </div>

            {!receipt ? (
              <div className="empty-state">
                <div className="radar"><ShieldCheck size={35} /></div>
                <h3>No action evaluated</h3>
                <p>Submit a proposal to see the risk analysis, policy decision, and receipt.</p>
              </div>
            ) : (
              <div className="result">
                <div className={`decision-banner ${meta!.tone}`}>
                  <span>{DecisionIcon && <DecisionIcon size={24} />}</span>
                  <div>
                    <small>POLICY DECISION</small>
                    <h3>{meta!.label}</h3>
                  </div>
                </div>

                <div className="risk-heading">
                  <div>
                    <small>ASSESSED RISK</small>
                    <strong>{receipt.assessment.riskLevel}</strong>
                  </div>
                  <span>{receipt.assessment.blastRadius.replace("_", " ")} impact</span>
                </div>

                <p className="summary">{receipt.assessment.summary}</p>

                <div className="evidence">
                  <h4>Why this decision</h4>
                  <ul>
                    {receipt.decision.rationale.map((item, index) => (
                      <li key={`policy-${index}`}>{item}</li>
                    ))}
                    {receipt.assessment.reasons.slice(0, 3).map((item, index) => (
                      <li key={`model-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="receipt-strip">
                  <Fingerprint size={18} />
                  <div>
                    <small>SHA-256 DECISION DIGEST</small>
                    <code>{receipt.digest.slice(0, 28)}…</code>
                  </div>
                  <button type="button" onClick={() => downloadReceipt(receipt)} title="Download receipt">
                    <Download size={17} />
                  </button>
                </div>
              </div>
            )}
          </article>
        </section>

        <section className="how-it-works">
          <span className="step-label">THE CONTROL PATH</span>
          <h2>Fast for routine work. Accountable for everything else.</h2>
          <div className="flow">
            <div><span>1</span><strong>Propose</strong><p>An agent declares the intended action and target.</p></div>
            <ArrowRight />
            <div><span>2</span><strong>Assess locally</strong><p>Gemini Nano identifies risk on device. Confidential data never falls back to the cloud without consent.</p></div>
            <ArrowRight />
            <div><span>3</span><strong>Enforce policy</strong><p>Deterministic rules allow, escalate, or deny execution.</p></div>
            <ArrowRight />
            <div><span>4</span><strong>Prove</strong><p>A digest binds the proposal, assessment, and decision.</p></div>
          </div>
        </section>
      </main>

      <footer>
        <span>ConsequenceOS Edge Guard</span>
        <span>No receipt, no action.</span>
      </footer>
    </div>
  );
}

