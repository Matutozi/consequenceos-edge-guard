import type { ReactNode } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { APPROVER, type StepState } from "../../agent/useAgentRun";
import { canonicalJson } from "../../domain/receipt";
import { lookupTool } from "../../ops/registry";
import type { LoadedRegistry } from "../../ops/registryConfig";
import { decisionBadge, decisionLabel, routeLine, truncate } from "../format";

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
        <StepDetail step={step} registry={registry} onDecide={onDecide} />
      )}
      {children && <div className="infra">{children}</div>}
    </aside>
  );
}

function StepDetail({ step, registry, onDecide }: { step: StepState; registry?: LoadedRegistry; onDecide: Props["onDecide"] }) {
  const { plan, signed, phase } = step;
  const receipt = signed?.receipt;
  const call = plan.call;
  const meta = registry ? lookupTool(registry.registry, call.tool) : undefined;

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

      {phase === "awaiting" && (
        <div className="approval-box" role="group" aria-label="Approval">
          <p>{APPROVER.name} ({APPROVER.role}) has to approve this call before it can run.</p>
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

      {receipt && (
        <section>
          <h3>Reason</h3>
          <ul>{receipt.decision.rationale.map((line) => <li key={line}>{line}</li>)}</ul>
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
          <p>{routeLine(receipt.inferenceSource, step.ms)}</p>
          <p className="quiet">
            {receipt.inferenceSource === "IN_CLOUD"
              ? "Sent to Firebase AI Logic: the tool name, its arguments, the agent's reason and the registry description. Nothing else from the ticket."
              : receipt.inferenceSource === "ON_DEVICE"
                ? "Assessed by Gemini Nano. Nothing left this device."
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
              ? `Ran${step.approvedBy ? `, approved by ${step.approvedBy}` : ""}. ${truncate(step.output ?? "", 200)}`
              : phase === "rejected"
                ? `Not run. ${APPROVER.name} rejected it.`
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
  );
}
