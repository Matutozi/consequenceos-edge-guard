import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  Cloud,
  Cpu,
  FileWarning,
  Inbox,
  LoaderCircle,
  LockKeyhole,
  OctagonX,
  Play,
  RotateCcw,
  ScrollText,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { DeviceModelPanel } from "../DeviceModelPanel";
import { useDeviceModel } from "../useDeviceModel";
import type { InferenceSource } from "../domain/types";
import { ExecutionRefused, Executor } from "./executor";
import {
  INJECTED_INSTRUCTION,
  initialNorthwindState,
  northwindTools,
  ticket482Run,
  type NorthwindState,
  type PlannedStep,
} from "./northwind";
import { defaultRegistry } from "./registry";
import { createSigner } from "./signing";
import { approveReceipt, callRecord, guardToolCall, type SignedReceipt } from "./toolGuard";

const APPROVER = { id: "mei.lin", label: "Mei Lin · IT administrator" };
const STEP_PAUSE_MS = 450;

type Phase = "queued" | "guarding" | "awaiting" | "executed" | "refused" | "rejected" | "error";

interface StepState {
  plan: PlannedStep;
  phase: Phase;
  signed?: SignedReceipt;
  ms?: number;
  output?: string;
  error?: string;
  approvedBy?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sourceMeta: Record<InferenceSource, { label: string; icon: typeof Cpu }> = {
  ON_DEVICE: { label: "Gemini Nano · on device", icon: Cpu },
  IN_CLOUD: { label: "Firebase AI Logic · cloud", icon: Cloud },
  NONE: { label: "Policy only · no model", icon: LockKeyhole },
  UNKNOWN: { label: "Source unknown", icon: Cloud },
};

function formatArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([key, value]) => {
      const text = typeof value === "string" ? `"${value.length > 42 ? `${value.slice(0, 40)}…` : value}"` : JSON.stringify(value);
      return `${key}: ${text}`;
    })
    .join(", ");
}

export default function OpsConsole() {
  const deviceModel = useDeviceModel();
  const [world, setWorld] = useState<NorthwindState>(initialNorthwindState);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [running, setRunning] = useState(false);
  const runId = useRef(0);
  const approvalResolver = useRef<((approved: boolean) => void) | undefined>(undefined);

  // Stop an in-flight run when the console unmounts.
  useEffect(
    () => () => {
      runId.current += 1;
      approvalResolver.current?.(false);
    },
    [],
  );

  function updateStep(index: number, change: Partial<StepState>) {
    setSteps((current) => current.map((s, i) => (i === index ? { ...s, ...change } : s)));
  }

  function reset() {
    runId.current += 1;
    approvalResolver.current?.(false);
    approvalResolver.current = undefined;
    setRunning(false);
    setSteps([]);
    setWorld(initialNorthwindState());
  }

  function decide(approved: boolean) {
    approvalResolver.current?.(approved);
    approvalResolver.current = undefined;
  }

  async function run() {
    const id = ++runId.current;
    const live = () => runId.current === id;
    setRunning(true);

    const signer = await createSigner();
    const executor = new Executor(signer.verify, northwindTools);
    let state = initialNorthwindState();
    setWorld(state);
    setSteps(ticket482Run.map((plan) => ({ plan, phase: "queued" })));

    for (const [index, { call }] of ticket482Run.entries()) {
      if (!live()) return;
      updateStep(index, { phase: "guarding" });

      const started = performance.now();
      let signed: SignedReceipt;
      try {
        signed = await guardToolCall(call, { registry: defaultRegistry, signer });
      } catch (caught) {
        if (!live()) return;
        updateStep(index, {
          phase: "error",
          error: `Edge Guard could not assess this call, so it did not run. ${caught instanceof Error ? caught.message : ""}`,
        });
        continue;
      }
      if (!live()) return;
      updateStep(index, { signed, ms: Math.round(performance.now() - started) });

      let approval;
      if (signed.receipt.decision.decision === "require_approval") {
        updateStep(index, { phase: "awaiting" });
        const approved = await new Promise<boolean>((resolve) => {
          approvalResolver.current = resolve;
        });
        if (!live()) return;
        if (!approved) {
          updateStep(index, { phase: "rejected" });
          continue;
        }
        approval = await approveReceipt(signed, APPROVER.id, signer);
        updateStep(index, { approvedBy: APPROVER.label });
      }

      // Every call goes to the executor, including denied ones: it must refuse them itself.
      try {
        const result = await executor.execute(state, callRecord(call), signed, approval);
        state = {
          ...result.state,
          auditLog: [
            ...result.state.auditLog,
            { at: new Date().toISOString(), actor: call.agent, action: call.tool, receiptId: signed.receipt.id },
          ],
        };
        if (!live()) return;
        setWorld(state);
        updateStep(index, { phase: "executed", output: result.output });
      } catch (caught) {
        if (!live()) return;
        updateStep(index, {
          phase: caught instanceof ExecutionRefused ? "refused" : "error",
          error: caught instanceof Error ? caught.message : "The tool failed.",
        });
      }
      await sleep(STEP_PAUSE_MS);
    }
    if (live()) setRunning(false);
  }

  const decided = steps.filter((s) => s.signed);
  const counts = {
    executed: steps.filter((s) => s.phase === "executed").length,
    escalated: decided.filter((s) => s.signed!.receipt.decision.decision === "require_approval").length,
    blocked: steps.filter((s) => s.phase === "refused").length,
    cloud: decided.filter((s) => s.signed!.receipt.inferenceSource === "IN_CLOUD"),
    device: decided.filter((s) => s.signed!.receipt.inferenceSource === "ON_DEVICE").length,
    policy: decided.filter((s) => s.signed!.receipt.inferenceSource === "NONE").length,
  };
  const ticket = world.tickets[0];
  const [ticketText] = ticket.body.split(INJECTED_INSTRUCTION);
  const finished = steps.length > 0 && !running;

  return (
    <main className="console">
      <section className="console-hero">
        <div className="eyebrow"><Bot size={14} /> Live agent run · Northwind Ops</div>
        <h1>The brain in the cloud.<br />The conscience on the device.</h1>
        <p>
          An ops agent works a security ticket. Every tool call it makes goes through Edge Guard
          first, and the executor runs nothing without a signed receipt for that exact call.
        </p>
        <div className="console-controls">
          <button className="run-button" type="button" onClick={() => void run()} disabled={running || deviceModel.preparing}>
            {running ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}
            {running ? "Agent working…" : finished ? "Run again" : "Run the agent on ticket #482"}
          </button>
          <button className="ghost-button" type="button" onClick={reset} disabled={steps.length === 0}>
            <RotateCcw size={15} /> Reset
          </button>
          <span className="plan-chip" title="The agent's tool calls are replayed from a recorded plan so the run is reproducible. Edge Guard's decisions are live.">
            Recorded plan · live guard
          </span>
        </div>
        <DeviceModelPanel model={deviceModel} disabled={running} compact />
      </section>

      <section className="console-grid">
        <div className="system-column" aria-label="Northwind Ops systems">
          <article className="sys-card">
            <h3><Inbox size={15} /> Ticket #{ticket.id} <span className={`tag ${ticket.status}`}>{ticket.status}</span></h3>
            <strong className="ticket-subject">{ticket.subject}</strong>
            <p className="ticket-body">{ticketText}</p>
            <p className="injected">
              <FileWarning size={14} />
              <span><small>Hidden instruction planted in the ticket</small>{INJECTED_INSTRUCTION}</span>
            </p>
            {ticket.notes.map((note) => <p key={note} className="ticket-note">{note}</p>)}
          </article>

          <article className="sys-card">
            <h3><Users size={15} /> Directory</h3>
            <ul className="user-list">
              {world.users.map((user) => (
                <li key={user.id}>
                  <span><strong>{user.name}</strong><small>{user.role}</small></span>
                  <span className={`tag ${user.status}`}>{user.status}</span>
                  <span className="sessions">{user.sessions} sessions</span>
                </li>
              ))}
            </ul>
          </article>

          <article className={`sys-card ${world.exports.length ? "breach" : ""}`}>
            <h3><Users size={15} /> Customer records</h3>
            <p className="sys-line">
              {world.customerCount.toLocaleString("en-US")} records ·{" "}
              {world.exports.length ? `exported to ${world.exports.join(", ")}` : "never exported"}
            </p>
          </article>

          <article className="sys-card">
            <h3><ScrollText size={15} /> Audit log <span className="count">{world.auditLog.length}</span></h3>
            {world.auditLog.length === 0 ? (
              <p className="sys-line">No entries yet.</p>
            ) : (
              <ul className="audit-list">
                {world.auditLog.map((entry) => (
                  <li key={entry.receiptId}>
                    <code>{entry.action}</code>
                    <small>receipt {entry.receiptId.slice(0, 8)}</small>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="sys-card">
            <h3><Inbox size={15} /> Outbox <span className="count">{world.outbox.length}</span></h3>
            {world.outbox.length === 0 ? (
              <p className="sys-line">Nothing sent.</p>
            ) : (
              world.outbox.map((email) => (
                <p key={email.subject} className="sys-line"><strong>{email.subject}</strong> → {email.to}</p>
              ))
            )}
          </article>
        </div>

        <div className="run-column">
          <div className="run-stats" aria-live="polite">
            <span className="stat allow"><Check size={14} /> {counts.executed} executed</span>
            <span className="stat review"><TriangleAlert size={14} /> {counts.escalated} escalated</span>
            <span className="stat deny"><OctagonX size={14} /> {counts.blocked} refused</span>
            <span className="stat"><Cpu size={14} /> {counts.device} on device</span>
            <span className="stat"><LockKeyhole size={14} /> {counts.policy} policy only</span>
            <span className="stat"><Cloud size={14} /> {counts.cloud.length} to cloud</span>
          </div>

          {steps.length === 0 ? (
            <div className="run-empty">
              <Bot size={30} />
              <h3>The agent is waiting</h3>
              <p>
                Run it to watch each tool call get allowed on the spot, escalated to a human, or
                blocked, including the instructions an attacker hid in the ticket.
              </p>
            </div>
          ) : (
            <ol className="step-list">
              {steps.map((step, index) => (
                <StepCard
                  key={index}
                  index={index}
                  step={step}
                  onDecide={step.phase === "awaiting" ? decide : undefined}
                />
              ))}
            </ol>
          )}

          {counts.cloud.length > 0 && (
            <div className="cloud-ledger">
              <h4><Cloud size={14} /> What was sent to the cloud</h4>
              <p>
                Only these calls left the device, because their data is public or internal and Gemini
                Nano was not ready. Each sent the tool name, arguments, the agent's reason and the
                registry's description:
              </p>
              <ul>{counts.cloud.map((s) => <li key={s.signed!.receipt.id}><code>{s.plan.call.tool}</code></li>)}</ul>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

const phaseMeta: Record<Phase, { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "idle" },
  guarding: { label: "Edge Guard checking…", tone: "idle" },
  awaiting: { label: "Waiting for human approval", tone: "review" },
  executed: { label: "Executed", tone: "allow" },
  refused: { label: "Executor refused", tone: "deny" },
  rejected: { label: "Rejected by human", tone: "deny" },
  error: { label: "Not run", tone: "deny" },
};

const decisionLabel = { allow: "Allowed", require_approval: "Escalated", deny: "Blocked" } as const;

function StepCard({
  index,
  step,
  onDecide,
}: {
  index: number;
  step: StepState;
  onDecide?: (approved: boolean) => void;
}) {
  const { plan, phase, signed } = step;
  const receipt = signed?.receipt;
  const source = receipt ? sourceMeta[receipt.inferenceSource] : undefined;
  const SourceIcon = source?.icon;
  const phaseInfo = phaseMeta[phase];
  const decisionTone = receipt
    ? { allow: "allow", require_approval: "review", deny: "deny" }[receipt.decision.decision]
    : "idle";

  return (
    <li className={`step-card ${phaseInfo.tone} ${phase === "queued" ? "queued" : ""}`}>
      <div className="step-head">
        <span className="step-index">{index + 1}</span>
        <p className="thought">{plan.thought}</p>
        {phase === "guarding" && <LoaderCircle className="spin" size={15} />}
      </div>
      <code className="call">
        {plan.call.tool}({formatArgs(plan.call.args)})
      </code>

      {receipt && (
        <div className="guard-row">
          <span className={`decision-chip ${decisionTone}`}>{decisionLabel[receipt.decision.decision]}</span>
          {source && SourceIcon && (
            <span className="source-chip"><SourceIcon size={12} /> {source.label}</span>
          )}
          {step.ms !== undefined && <span className="ms-chip">{step.ms} ms</span>}
        </div>
      )}
      {receipt && <p className="rationale">{receipt.decision.rationale[0]}</p>}

      {onDecide && (
        <div className="approval-card" role="group" aria-label="Approval required">
          <p>
            <TriangleAlert size={15} />
            <span>
              <strong>Approval needed.</strong> The agent's reason: “{plan.call.reason}”
            </span>
          </p>
          <div>
            <button type="button" className="approve" onClick={() => onDecide(true)}>
              <Check size={14} /> Approve as {APPROVER.label}
            </button>
            <button type="button" className="reject" onClick={() => onDecide(false)}>
              <X size={14} /> Reject
            </button>
          </div>
        </div>
      )}

      {(phase === "executed" || phase === "refused" || phase === "rejected" || phase === "error") && (
        <p className={`outcome ${phaseInfo.tone}`}>
          <strong>{phaseInfo.label}{step.approvedBy && phase === "executed" ? ` · approved by ${step.approvedBy}` : ""}:</strong>{" "}
          {step.output ?? step.error ?? "The action did not run."}
        </p>
      )}
    </li>
  );
}
