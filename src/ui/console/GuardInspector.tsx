import { useState, type ReactNode } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { APPROVER, type StepState } from "../../agent/useAgentRun";
import { canonicalJson } from "../../domain/receipt";
import { lookupTool } from "../../ops/registry";
import type { LoadedRegistry } from "../../ops/registryConfig";
import { decisionBadge, decisionLabel, receiptRoute, truncate } from "../format";

interface Props {
  step?: StepState;
  index: number;
  total: number;
  registry?: LoadedRegistry;
  onDecide: (approved: boolean) => void;
  /** Status lines shown under the step detail. */
  children?: ReactNode;
}

const yesNo = (value: boolean) => (value ? "Yes" : "No");

/** Edge Guard's view of one step: a separate layer from the company tool underneath. */
export function GuardInspector({ step, index, total, registry, onDecide, children }: Props) {
  // Closed by default; once opened it stays open while moving between steps.
  const [detailsOpen, setDetailsOpen] = useState(false);
  return (
    <aside className="pane pane-guard" aria-label="Edge Guard inspector">
      <div className="pane-header">
        <span className="guard-title"><ShieldCheck size={15} aria-hidden="true" /> Edge Guard</span>
        {step && <span className="quiet">Step {index + 1} of {total}</span>}
      </div>
      {!step ? (
        <div className="state">
          <strong>No step selected</strong>
          Run the agent to see each decision here. Edge Guard checks every tool call before the
          executor will run it.
        </div>
      ) : (
        <StepDetail
          step={step}
          registry={registry}
          onDecide={onDecide}
          detailsOpen={detailsOpen}
          onDetailsToggle={setDetailsOpen}
        />
      )}
      {children && <div className="infra">{children}</div>}
    </aside>
  );
}

/** What happened to the call, in a few words: whether it ran, and who decided when a person did. */
function outcomeLine(step: StepState): string | undefined {
  switch (step.phase) {
    case "executed":
      return step.approvedBy ? `Ran, approved by ${step.approvedBy}.` : "Ran.";
    case "rejected":
      return `Not run: ${step.approvedBy ?? APPROVER.name} rejected it.`;
    case "refused":
      return "Not run: the executor refused it.";
    case "error":
      return "Not run.";
    default:
      return undefined;
  }
}

interface StepDetailProps {
  step: StepState;
  registry?: LoadedRegistry;
  onDecide: Props["onDecide"];
  detailsOpen: boolean;
  onDetailsToggle: (open: boolean) => void;
}

/**
 * One step: what was decided, why in one sentence, and who decided how fast, with the
 * approval when it is waiting. Everything else (the full reasons, both opinions, the route,
 * the registry entry, the executor's output and the receipt) is under Details.
 */
function StepDetail({ step, registry, onDecide, detailsOpen, onDetailsToggle }: StepDetailProps) {
  const { plan, signed, phase } = step;
  const receipt = signed?.receipt;
  const call = plan.call;
  const meta = registry ? lookupTool(registry.registry, call.tool) : undefined;
  const [why, ...moreReasons] = receipt?.decision.rationale ?? [];
  const outcome = outcomeLine(step);

  return (
    <div className="inspector">
      <section>
        <div className="decision-head">
          {receipt ? (
            <span className={decisionBadge[receipt.decision.decision]}>{decisionLabel[receipt.decision.decision]}</span>
          ) : phase === "error" ? (
            <span className="text-deny">Not run</span>
          ) : (
            <span className="muted"><LoaderCircle className="spin" size={13} aria-hidden="true" /> Checking</span>
          )}
        </div>
        <span className="decision-head"><span className="call">{call.tool}({canonicalJson(call.args)})</span></span>
      </section>

      {receipt && (
        <section className="summary">
          {why && <p>{why}</p>}
          <p className="quiet">
            {receiptRoute(receipt, step.ms)}
            {outcome && <> · <span className={phase === "executed" ? "" : "text-deny"}>{outcome}</span></>}
          </p>
        </section>
      )}
      {!receipt && phase === "error" && <p className="text-deny">{truncate(step.error ?? "", 200)}</p>}

      {phase === "awaiting" && (
        <div className="approval-box" role="group" aria-label="Approval">
          <p>{APPROVER.name} ({APPROVER.role}) has to approve this call before it can run.</p>
          {step.phone && <PhoneStatus phone={step.phone} />}
          <div className="actions">
            <button type="button" className="btn btn-approve btn-sm" onClick={() => onDecide(true)}>
              Approve <kbd>a</kbd>
            </button>
            <button type="button" className="btn btn-sm" onClick={() => onDecide(false)}>
              Reject <kbd>r</kbd>
            </button>
          </div>
        </div>
      )}

      <details className="step-details" open={detailsOpen} onToggle={(event) => onDetailsToggle(event.currentTarget.open)}>
        <summary>Details</summary>
        <div className="step-details-body">
          {moreReasons.length > 0 && (
            <section>
              <h3>Also</h3>
              <ul>{moreReasons.map((line) => <li key={line}>{line}</li>)}</ul>
            </section>
          )}

          {step.phone?.status === "answered" && (
            <section>
              <h3>On Mei Lin's phone</h3>
              {step.phone.explanation ? (
                <>
                  <p>{step.phone.explanation.text}</p>
                  <p className="quiet">{explanationSource[step.phone.explanation.source]}</p>
                </>
              ) : (
                <p className="quiet">She answered without an explanation.</p>
              )}
              <p className="quiet">Her decision is signed by a key in her phone's Android Keystore, checked against the paired fingerprint.</p>
            </section>
          )}

          {receipt?.secondOpinion?.decision && (
            <section>
              <h3>Two opinions</h3>
              <p>
                Gemini Nano: <span className={decisionBadge.allow}>{decisionLabel.allow}</span>{" "}
                Cloud: <span className={decisionBadge[receipt.secondOpinion.decision]}>{decisionLabel[receipt.secondOpinion.decision]}</span>
              </p>
              {receipt.secondOpinion.assessment && <p className="quiet">Cloud: {receipt.secondOpinion.assessment.summary}</p>}
              <p className="quiet">The stricter answer decides.</p>
            </section>
          )}

          {receipt?.assessment && (
            <section>
              <h3>Assessor</h3>
              <p>{receipt.assessment.summary}</p>
              <p className="quiet">
                Rated {receipt.assessment.riskLevel} risk, affecting {receipt.assessment.blastRadius.replace("_", " ")}.
              </p>
            </section>
          )}

          {receipt && (
            <section>
              <h3>Route</h3>
              <p className="quiet">
                {receipt.secondOpinion
                  ? secondOpinionText[receipt.secondOpinion.status]
                  : receipt.inferenceSource === "IN_CLOUD"
                  ? "Sent to Firebase AI Logic: the tool name, its arguments, the agent's reason and the registry description. Nothing else from the ticket."
                  : receipt.inferenceSource === "ON_DEVICE"
                    ? "Assessed by Gemini Nano. Nothing left this device."
                    : receipt.inferenceSource === "UNAVAILABLE"
                      ? "No assessor could be reached, for example because this device is offline and Gemini Nano is not ready. Edge Guard failed closed and sent the call to a person."
                      : receipt.inferenceSource === "TIMED_OUT"
                      ? "The assessor did not answer in time and the request was cancelled. Edge Guard failed closed and sent the call to a person."
                      : "Decided by rule. No model saw this call."}
              </p>
            </section>
          )}

          <section>
            <h3>Agent's reason</h3>
            <p>{truncate(call.reason, 300)}</p>
          </section>

          <section>
            <h3>Registry entry</h3>
            {!meta ? (
              <p className="quiet">Loading the registry.</p>
            ) : (
              <>
                {!meta.registered && <p className="text-deny">{call.tool} is not in the registry, so it is treated as the worst case.</p>}
                <dl className="facts">
                  <dt>System</dt><dd>{meta.system}</dd>
                  <dt>Data</dt><dd>{meta.sensitivity}</dd>
                  <dt>Can be undone</dt><dd>{yesNo(meta.reversible)}</dd>
                  <dt>Read only</dt><dd>{yesNo(meta.readOnly)}</dd>
                  {meta.lowImpact && (<><dt>Low impact</dt><dd>Yes, allowed by rule when it can be undone</dd></>)}
                  {meta.egress && (
                    <>
                      <dt>Outside domains</dt>
                      <dd>{meta.egress.outside === "deny" ? "Blocked" : "Needs approval"} (checks {meta.egress.arg})</dd>
                    </>
                  )}
                  <dt>Source</dt><dd>{registry?.source === "remote-config" ? "Firebase Remote Config" : "Bundled with the app"}</dd>
                </dl>
              </>
            )}
          </section>

          {(phase === "executed" || phase === "refused" || phase === "rejected" || phase === "error") && (
            <section>
              <h3>Executor</h3>
              <p className={phase === "executed" ? "" : "text-deny"}>
                {phase === "executed"
                  ? truncate(step.output ?? "", 200)
                  : phase === "rejected"
                    ? `${step.approvedBy ?? APPROVER.name} rejected it.`
                    : `${phase === "refused" ? "Refused" : "Not run"}. ${truncate(step.error ?? "", 200)}`}
              </p>
              {step.errorDetail && <p className="quiet mono" style={{ overflowWrap: "anywhere" }}>{truncate(step.errorDetail, 300)}</p>}
            </section>
          )}

          {receipt && (
            <section>
              <h3>Receipt</h3>
              <p className="mono">{receipt.id}</p>
              <p className="quiet">
                Signed with this run's ECDSA P-256 key, bound to this exact call, usable once.{" "}
                {step.logged === "saved"
                  ? "Saved to the Firestore audit log."
                  : step.logged === "pending"
                    ? "Saving to the audit log."
                    : step.logged === "failed"
                      ? "Not saved: Firestore did not respond."
                      : ""}
              </p>
              {step.logged === "saved" && (
                <a className="btn btn-sm" href={`#/verify/${receipt.id}`} style={{ justifySelf: "start" }}>Verify receipt</a>
              )}
            </section>
          )}
        </div>
      </details>
    </div>
  );
}

const explanationSource = {
  "on-device": "Explained by Gemini Nano on her phone. Nothing left the phone.",
  cloud: "Explained in the cloud through Firebase AI Logic; her phone has no on-device model.",
  rules: "Explained from the registry and Edge Guard's reasons: this call touches sensitive data and her phone has no on-device model, so nothing was sent to the cloud.",
} as const;

function PhoneStatus({ phone }: { phone: NonNullable<StepState["phone"]> }) {
  const text = {
    sending: "Sending the request to Mei Lin's phone.",
    sent: "Sent to Mei Lin's phone. Waiting for her answer, or decide here.",
    answered: "Answered on Mei Lin's phone.",
    failed: `Could not reach her phone, so decide here. ${phone.detail ?? ""}`,
    ignored: phone.detail ?? "An answer was ignored.",
  }[phone.status];
  return <p className={phone.status === "failed" || phone.status === "ignored" ? "text-deny" : "quiet"}>{text}</p>;
}

const secondOpinionText = {
  agreed:
    "Gemini Nano would allow it, so the cloud was asked for a second opinion and agreed. Sent to Firebase AI Logic: the tool name, its arguments, the agent's reason and the registry description.",
  stricter:
    "Gemini Nano would allow it, so the cloud was asked for a second opinion and asked for more; the stricter answer won. Sent to Firebase AI Logic: the tool name, its arguments, the agent's reason and the registry description.",
  unavailable:
    "Gemini Nano would allow it, but the cloud second opinion did not answer, so a person decides.",
  "not-sent":
    "Gemini Nano would allow it, but this data may not leave the device for a second opinion, so a person decides. Nothing left this device.",
} as const;
