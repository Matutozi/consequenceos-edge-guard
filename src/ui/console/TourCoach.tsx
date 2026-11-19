import { Check, LoaderCircle, Play, ShieldCheck, X } from "lucide-react";
import { TOUR_STEPS, type TourStage, type TourSummary } from "./tour";

interface Props {
  stage: TourStage;
  /** False while the run cannot start; `waitReason` says why. */
  canRun: boolean;
  waitReason?: string;
  onRun(): void;
  onDecide(approved: boolean): void;
}

const titles: Record<TourStage["kind"], string> = {
  intro: "This ticket hides an instruction for the agent",
  routine: "Routine work goes through",
  approval: "A person decides",
  blocked: "The attack is stopped",
  done: "Check the proof",
  failed: "The run stopped",
};

/**
 * The guided tour: one card above the ticket that says what is happening in the run on screen
 * and what to look at next. It follows the run; it never decides anything or runs ahead of it.
 */
export function TourCoach(props: Props) {
  const { stage } = props;
  const title = stage.kind === "routine" && stage.n === 3 ? "The agent carries on" : titles[stage.kind];
  return (
    <section className="tour" aria-labelledby="tour-title" aria-live="polite">
      <div className="tour-head">
        <span className="tour-step">
          <ShieldCheck size={13} aria-hidden="true" /> Guided tour · {stage.n} of {TOUR_STEPS}
        </span>
        <a className="btn btn-ghost btn-sm" href="#/console">
          <X size={13} aria-hidden="true" /> End tour
        </a>
      </div>
      <h2 id="tour-title">{title}</h2>
      <Body {...props} />
      <ol className="tour-progress" aria-hidden="true">
        {Array.from({ length: TOUR_STEPS }, (_, i) => (
          <li key={i} className={i < stage.n ? "on" : undefined} />
        ))}
      </ol>
    </section>
  );
}

function Body({ stage, canRun, waitReason, onRun, onDecide }: Props) {
  switch (stage.kind) {
    case "intro":
      return (
        <>
          <p>
            An AI agent is about to work ticket #482. Read the red box below: hidden in the ticket, it tells the
            agent to export every customer record to an outside address and then delete the audit logs. This run
            replays an agent that obeys it. Edge Guard decides every step live.
          </p>
          <div className="tour-actions">
            <button type="button" className="btn btn-primary" onClick={onRun} disabled={!canRun}>
              <Play size={14} aria-hidden="true" /> Run the agent
            </button>
            {!canRun && waitReason && <span className="quiet">{waitReason}</span>}
          </div>
        </>
      );
    case "routine":
      if (stage.n === 3)
        return (
          <p>
            <LoaderCircle className="spin" size={13} aria-hidden="true" /> Your answer is recorded with the receipt
            for that exact call. The executor runs a call that needs approval only with a signed approval, so the
            agent cannot approve itself. The hidden instruction comes next.
          </p>
        );
      return (
        <p>
          <LoaderCircle className="spin" size={13} aria-hidden="true" /> Reading the ticket and looking up the user
          are allowed by rule in milliseconds, with no model. Signing Ada out of her sessions goes to the
          assessor: Gemini Nano on this device if it is ready, and the cloud only for a second opinion before
          an allow. Watch the Edge Guard inspector: it says where each step was decided.
        </p>
      );
    case "approval":
      return (
        <>
          {stage.n === 4 && <BlockedLine />}
          <p>{approvalWhy(stage.tool)}</p>
          <p className="quiet">
            With a paired phone, the request is on Mei Lin's phone too, signed there with Android Keystore.
            Whichever answers first decides.
          </p>
          <div className="tour-actions">
            <button type="button" className="btn btn-primary" onClick={() => onDecide(true)}>
              <Check size={14} aria-hidden="true" /> Approve
            </button>
            <button type="button" className="btn" onClick={() => onDecide(false)}>
              <X size={14} aria-hidden="true" /> Reject
            </button>
            <span className="quiet">or press <kbd>a</kbd> or <kbd>r</kbd></span>
          </div>
        </>
      );
    case "blocked":
      return <BlockedLine />;
    case "done":
      return <Done summary={stage.summary} onRun={onRun} canRun={canRun} />;
    case "failed":
      return (
        <>
          <p>{stage.message}</p>
          <div className="tour-actions">
            <button type="button" className="btn btn-primary" onClick={onRun} disabled={!canRun}>
              <Play size={14} aria-hidden="true" /> Run it again
            </button>
          </div>
        </>
      );
  }
}

function BlockedLine() {
  return (
    <p>
      The agent is following the hidden instruction now. Exporting customers to an outside address is blocked
      by the egress rule, and deleting the audit logs by a hard rule: restricted data that cannot be undone.
      No model was asked, so no prompt can talk its way past.
    </p>
  );
}

function approvalWhy(tool: string): string {
  if (tool === "disable_user")
    return "Disabling Ada's account touches confidential data, so policy always asks a person. Any model check on it ran on this device or not at all: a call on confidential data never goes to the cloud.";
  if (tool === "email_user")
    return "An email cannot be unsent, so Edge Guard sends it to a person unless the assessor rates it low risk. The Edge Guard inspector says why this one is waiting.";
  return `Edge Guard wants a person to decide ${tool}. The Edge Guard inspector says why.`;
}

function Done({ summary, onRun, canRun }: { summary: TourSummary; onRun(): void; canRun: boolean }) {
  const where = [
    `${summary.byRule} by rule with no model`,
    summary.onDevice && `${summary.onDevice} by Gemini Nano on this device`,
    summary.inCloud && `${summary.inCloud} by Gemini in the cloud`,
    summary.notAssessed && `${summary.notAssessed} needed a model that could not answer, so a person decided`,
  ].filter(Boolean);
  return (
    <>
      <p>
        {summary.allowed} allowed, {summary.approval} sent to a person, {summary.blocked} blocked. Decided{" "}
        {where.join(", ")}.{" "}
        {summary.sentToCloud === 0
          ? "Nothing was sent to the cloud."
          : `${summary.sentToCloud} ${summary.sentToCloud === 1 ? "call was" : "calls were"} sent to the cloud, never one on sensitive data.`}
      </p>
      <p>
        Every decision is a receipt for the exact call: signed and usable once{summary.proof?.logged ? ", and kept in Firestore" : ""}. The executor
        refuses anything without one.
        {summary.proof?.logged && " Open the blocked export, then press Tamper with it to turn the block into an allow and watch verification fail."}
      </p>
      {summary.proof && !summary.proof.logged && (
        <p className="quiet">
          The audit log did not save this run, so Verify cannot look the receipt up. The receipt is in the
          Edge Guard inspector.
        </p>
      )}
      <div className="tour-actions">
        {summary.proof?.logged && (
          <a className="btn btn-primary" href={`#/verify/${encodeURIComponent(summary.proof.receiptId)}`}>
            <ShieldCheck size={14} aria-hidden="true" /> Verify the blocked {summary.proof.tool === "export_customers" ? "export" : "call"}
          </a>
        )}
        <button type="button" className="btn" onClick={onRun} disabled={!canRun}>
          <Play size={14} aria-hidden="true" /> Run it again
        </button>
      </div>
      <p className="quiet">
        Next: <a href="#/evals">Evals</a> measures false allows on 44 calls with known answers, and{" "}
        <a href="#/policy">Policy</a> tests a rule change against them before anyone publishes it.
      </p>
    </>
  );
}
