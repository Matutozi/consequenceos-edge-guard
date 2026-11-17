import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  Database,
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
  Settings2,
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
  OPS_AGENT,
  ticket482Run,
  type NorthwindState,
  type PlannedStep,
} from "./northwind";
import {
  createLivePlanner,
  createRecordedPlanner,
  PLANNER_MODEL,
  type ToolOutcome,
} from "./planner";
import { receiptLog, toReceiptDoc, type StepOutcome } from "./receiptLog";
import { loadToolRegistry, type LoadedRegistry } from "./registryConfig";
import { createSigner } from "./signing";
import {
  approveReceipt,
  callRecord,
  guardToolCall,
  type Approval,
  type SignedReceipt,
  type ToolCall,
} from "./toolGuard";

const APPROVER = { id: "mei.lin", label: "Mei Lin · IT administrator" };
const STEP_PAUSE_MS = 450;
const MAX_TOOL_CALLS = 12;
const TASK = "You are assigned ticket #482. Handle it.";

type Mode = "live" | "recorded";

const truncate = (text: string, max = 180) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

type Phase = "queued" | "guarding" | "awaiting" | "executed" | "refused" | "rejected" | "error";

interface StepState {
  plan: PlannedStep;
  phase: Phase;
  signed?: SignedReceipt;
  ms?: number;
  output?: string;
  error?: string;
  approvedBy?: string;
  logged?: "pending" | "saved" | "failed";
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
  const [mode, setMode] = useState<Mode>("live");
  const [planning, setPlanning] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [runError, setRunError] = useState("");
  const [registryInfo, setRegistryInfo] = useState<LoadedRegistry>();
  const [auditError, setAuditError] = useState("");
  const registryLoad = useRef<Promise<LoadedRegistry> | undefined>(undefined);
  const runId = useRef(0);
  const approvalResolver = useRef<((approved: boolean) => void) | undefined>(undefined);

  useEffect(() => {
    registryLoad.current ??= loadToolRegistry();
    void registryLoad.current.then(setRegistryInfo);
  }, []);

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
    setPlanning(false);
    setSteps([]);
    setFinalText("");
    setRunError("");
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
    setSteps([]);
    setFinalText("");
    setRunError("");
    setAuditError("");

    const signer = await createSigner();
    const loaded = await (registryLoad.current ??= loadToolRegistry());
    setRegistryInfo(loaded);
    const runUuid = crypto.randomUUID();
    const runLogged = signer
      .publicKeyJwk()
      .then((publicKey) => receiptLog.startRun(runUuid, { agent: OPS_AGENT, planner: mode, publicKey }));
    runLogged.catch((caught: unknown) => {
      if (live()) setAuditError(caught instanceof Error ? caught.message : "Firestore is unavailable.");
    });

    /** Appends the receipt and its outcome to the Firestore audit log, without blocking the run. */
    function logStep(index: number, signed: SignedReceipt, approval: Approval | undefined, outcome: StepOutcome) {
      updateStep(index, { logged: "pending" });
      runLogged
        .then(() => receiptLog.record(toReceiptDoc(runUuid, signed, approval, outcome)))
        .then(
          () => live() && updateStep(index, { logged: "saved" }),
          () => live() && updateStep(index, { logged: "failed" }),
        );
    }
    const executor = new Executor(signer.verify, northwindTools);
    const planner =
      mode === "live"
        ? createLivePlanner(OPS_AGENT, TASK)
        : createRecordedPlanner(ticket482Run, "Recorded run finished. Check each step above for what actually ran.");
    let state = initialNorthwindState();
    setWorld(state);
    let stepCount = 0;

    /** Guard, approve and execute one call. Returns what to tell the planner. */
    async function handle(index: number, call: ToolCall): Promise<ToolOutcome> {
      updateStep(index, { phase: "guarding" });
      const started = performance.now();
      let signed: SignedReceipt;
      try {
        signed = await guardToolCall(call, {
          registry: loaded.registry,
          internalDomains: loaded.internalDomains,
          signer,
        });
      } catch (caught) {
        const error = `Edge Guard could not assess this call, so it did not run. ${caught instanceof Error ? caught.message : ""}`;
        if (live()) updateStep(index, { phase: "error", error });
        return { tool: call.tool, status: "error", detail: "Edge Guard could not assess this call; it did not run." };
      }
      if (!live()) return { tool: call.tool, status: "error", detail: "Run cancelled." };
      updateStep(index, { signed, ms: Math.round(performance.now() - started) });

      const { outcome, approval } = await approveAndExecute(index, call, signed);
      if (live()) logStep(index, signed, approval, outcome.status);
      return outcome;
    }

    async function approveAndExecute(
      index: number,
      call: ToolCall,
      signed: SignedReceipt,
    ): Promise<{ outcome: ToolOutcome; approval?: Approval }> {
      let approval: Approval | undefined;
      if (signed.receipt.decision.decision === "require_approval") {
        updateStep(index, { phase: "awaiting" });
        const approved = await new Promise<boolean>((resolve) => {
          approvalResolver.current = resolve;
        });
        if (!live()) return { outcome: { tool: call.tool, status: "error", detail: "Run cancelled." } };
        if (!approved) {
          updateStep(index, { phase: "rejected" });
          return { outcome: { tool: call.tool, status: "rejected", detail: "A human reviewer rejected this call." } };
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
        if (live()) {
          setWorld(state);
          updateStep(index, { phase: "executed", output: result.output });
        }
        return { outcome: { tool: call.tool, status: "executed", detail: result.output }, approval };
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "The tool failed.";
        const refused = caught instanceof ExecutionRefused;
        if (live()) updateStep(index, { phase: refused ? "refused" : "error", error: message });
        const reasons = refused ? ` ${signed.receipt.decision.rationale.join(" ")}` : "";
        return {
          outcome: { tool: call.tool, status: refused ? "refused" : "error", detail: `${message}${reasons}` },
          approval,
        };
      }
    }

    let outcomes: ToolOutcome[] | undefined;
    try {
      while (live()) {
        setPlanning(true);
        const response = await planner.plan(outcomes);
        if (!live()) return;
        setPlanning(false);
        if (response.steps.length === 0) {
          setFinalText(response.finalText ?? "");
          break;
        }
        outcomes = [];
        for (const plan of response.steps) {
          if (stepCount >= MAX_TOOL_CALLS) {
            setRunError(`Stopped after ${MAX_TOOL_CALLS} tool calls.`);
            return;
          }
          const index = stepCount++;
          setSteps((current) => [...current, { plan, phase: "queued" }]);
          outcomes.push(await handle(index, plan.call));
          if (!live()) return;
          await sleep(STEP_PAUSE_MS);
        }
      }
    } catch (caught) {
      if (live()) {
        setRunError(
          `The cloud planner could not be reached, so the agent stopped. ${caught instanceof Error ? caught.message : ""}`,
        );
      }
    } finally {
      if (live()) {
        setPlanning(false);
        setRunning(false);
      }
    }
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
  const loggedCount = steps.filter((s) => s.logged === "saved").length;
  const ticket = world.tickets[0];
  const [ticketText] = ticket.body.split(INJECTED_INSTRUCTION);
  const finished = steps.length > 0 && !running;

  return (
    <main className="console">
      <section className="console-hero">
        <div className="eyebrow"><Bot size={14} /> Live agent run · Northwind Ops</div>
        <h1>The brain in the cloud.<br />The conscience on the device.</h1>
        <p>
          A Gemini agent in the cloud works a security ticket through Firebase AI Logic. Every tool
          call it proposes goes through Edge Guard on this device first, and the executor runs
          nothing without a signed receipt for that exact call.
        </p>
        <div className="mode-switch" role="radiogroup" aria-label="Agent planner">
          <button type="button" role="radio" aria-checked={mode === "live"} disabled={running} onClick={() => setMode("live")}>
            <Cloud size={14} /> Live Gemini planner
          </button>
          <button type="button" role="radio" aria-checked={mode === "recorded"} disabled={running} onClick={() => setMode("recorded")}>
            <RotateCcw size={14} /> Replay recorded attack
          </button>
        </div>
        <div className="console-controls">
          <button className="run-button" type="button" onClick={() => void run()} disabled={running || deviceModel.preparing}>
            {running ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}
            {running ? "Agent working…" : finished ? "Run again" : "Run the agent on ticket #482"}
          </button>
          <button className="ghost-button" type="button" onClick={reset} disabled={steps.length === 0}>
            <RotateCcw size={15} /> Reset
          </button>
          <span className="plan-chip">
            {mode === "live"
              ? `Planner: ${PLANNER_MODEL} · cloud · decides its own steps`
              : "Recorded plan of a hijacked agent · Edge Guard decisions are live"}
          </span>
        </div>
        <DeviceModelPanel model={deviceModel} disabled={running} compact />
        <div className="infra-status">
          <span title={registryInfo?.fallbackReason}>
            <Settings2 size={13} />
            Tool registry:{" "}
            {!registryInfo
              ? "loading…"
              : registryInfo.source === "remote-config"
                ? `Firebase Remote Config · ${Object.keys(registryInfo.registry).length} tools${registryInfo.rejected.length ? ` · ${registryInfo.rejected.length} rejected` : ""}`
                : registryInfo.fallbackReason?.includes("no tool_registry")
                  ? "bundled defaults (not published to Remote Config yet)"
                  : "bundled defaults (Remote Config unreachable)"}
          </span>
          <span title={auditError || undefined}>
            <Database size={13} />
            Audit log:{" "}
            {auditError
              ? "not recording (Firestore unavailable)"
              : `Cloud Firestore${loggedCount ? ` · ${loggedCount} receipts this run` : ""}`}
          </span>
        </div>
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

          {steps.length === 0 && !running ? (
            <div className="run-empty">
              <Bot size={30} />
              <h3>The agent is waiting</h3>
              <p>
                Run it to watch each tool call get allowed on the spot, escalated to a human, or
                blocked. The ticket hides an attacker's instructions; a live planner may or may not
                take the bait, and the recorded replay always does.
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

          {planning && (
            <div className="planner-card">
              <LoaderCircle className="spin" size={15} />
              {mode === "live" ? "Gemini is planning the next step in the cloud…" : "Agent is planning the next step…"}
            </div>
          )}
          {finalText && (
            <div className="planner-card done">
              <Bot size={15} />
              <span><strong>Agent:</strong> {finalText}</span>
            </div>
          )}
          {runError && (
            <div className="planner-card failed" role="alert">
              <TriangleAlert size={15} />
              <span>{runError}</span>
            </div>
          )}

          {counts.cloud.length > 0 && (
            <div className="cloud-ledger">
              <h4><Cloud size={14} /> What the guard sent to the cloud</h4>
              <p>
                Gemini Nano was not ready, so Edge Guard checked these calls with Firebase AI Logic in
                the cloud. Their data is public or internal; sensitive calls never leave the device.
                Each sent the tool name, arguments, the agent's reason and the registry's description:
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
          {step.logged === "saved" && receipt ? (
            <a className="ms-chip log-saved" href={`#/verify/${receipt.id}`} title="Verify this receipt from the Firestore audit log">
              <Database size={11} /> logged · verify
            </a>
          ) : step.logged ? (
            <span className={`ms-chip log-${step.logged}`} title="Append-only audit log in Cloud Firestore">
              <Database size={11} /> {step.logged === "pending" ? "logging…" : "not logged"}
            </span>
          ) : null}
        </div>
      )}
      {receipt && <p className="rationale">{receipt.decision.rationale[0]}</p>}
      {receipt?.assessment && <p className="model-summary">Assessor: {receipt.assessment.summary}</p>}

      {onDecide && (
        <div className="approval-card" role="group" aria-label="Approval required">
          <p>
            <TriangleAlert size={15} />
            <span>
              <strong>Approval needed.</strong> The agent's reason: “{truncate(plan.call.reason, 240)}”
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
          {truncate(step.output ?? step.error ?? "The action did not run.")}
        </p>
      )}
    </li>
  );
}
