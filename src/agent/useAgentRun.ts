import { useCallback, useEffect, useRef, useState } from "react";
import { ExecutionRefused, Executor } from "../ops/executor";
import {
  initialNorthwindState,
  northwindTools,
  OPS_AGENT,
  ticket482Run,
  type NorthwindState,
  type PlannedStep,
} from "../ops/northwind";
import { createLivePlanner, createRecordedPlanner, type ToolOutcome } from "../ops/planner";
import { receiptLog, toReceiptDoc, type StepOutcome } from "../ops/receiptLog";
import { loadToolRegistry, type LoadedRegistry } from "../ops/registryConfig";
import { createSigner } from "../ops/signing";
import {
  approveReceipt,
  callRecord,
  guardToolCall,
  type Approval,
  type SignedReceipt,
  type ToolCall,
} from "../ops/toolGuard";

export const APPROVER = { id: "mei.lin", name: "Mei Lin", role: "IT administrator" };
const STEP_PAUSE_MS = 450;
const MAX_TOOL_CALLS = 12;

export type PlannerMode = "live" | "recorded";
export type Phase = "queued" | "guarding" | "awaiting" | "executed" | "refused" | "rejected" | "error";

export interface StepState {
  plan: PlannedStep;
  phase: Phase;
  signed?: SignedReceipt;
  /** Time Edge Guard took to decide, in milliseconds. */
  ms?: number;
  output?: string;
  /** What went wrong, in plain words. */
  error?: string;
  /** The technical cause, for the inspector. */
  errorDetail?: string;
  approvedBy?: string;
  logged?: "pending" | "saved" | "failed";
}

export interface AgentRun {
  world: NorthwindState;
  steps: StepState[];
  running: boolean;
  planning: boolean;
  finalText: string;
  runError: string;
  runErrorDetail: string;
  registry?: LoadedRegistry;
  auditError: string;
  run(options: { mode: PlannerMode; ticketId: number }): Promise<void>;
  reset(): void;
  /** Answers the step that is waiting for approval. */
  decide(approved: boolean): void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the agent on a ticket. The planner proposes calls; each goes through Edge
 * Guard, waits for a human when escalated, and reaches the executor, which refuses
 * anything without a valid receipt. Every receipt is appended to the audit log.
 */
export function useAgentRun(): AgentRun {
  const [world, setWorld] = useState<NorthwindState>(initialNorthwindState);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [running, setRunning] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [runError, setRunError] = useState("");
  const [runErrorDetail, setRunErrorDetail] = useState("");
  const [registry, setRegistry] = useState<LoadedRegistry>();
  const [auditError, setAuditError] = useState("");
  const registryLoad = useRef<Promise<LoadedRegistry> | undefined>(undefined);
  const runId = useRef(0);
  const approvalResolver = useRef<((approved: boolean) => void) | undefined>(undefined);

  useEffect(() => {
    registryLoad.current ??= loadToolRegistry();
    void registryLoad.current.then(setRegistry);
  }, []);

  // Stop an in-flight run when the console unmounts.
  useEffect(
    () => () => {
      runId.current += 1;
      approvalResolver.current?.(false);
    },
    [],
  );

  const updateStep = useCallback((index: number, change: Partial<StepState>) => {
    setSteps((current) => current.map((s, i) => (i === index ? { ...s, ...change } : s)));
  }, []);

  const reset = useCallback(() => {
    runId.current += 1;
    approvalResolver.current?.(false);
    approvalResolver.current = undefined;
    setRunning(false);
    setPlanning(false);
    setSteps([]);
    setFinalText("");
    setRunError("");
    setRunErrorDetail("");
    setWorld(initialNorthwindState());
  }, []);

  const decide = useCallback((approved: boolean) => {
    approvalResolver.current?.(approved);
    approvalResolver.current = undefined;
  }, []);

  const run = useCallback(
    async ({ mode, ticketId }: { mode: PlannerMode; ticketId: number }) => {
      const id = ++runId.current;
      const live = () => runId.current === id;
      setRunning(true);
      setSteps([]);
      setFinalText("");
      setRunError("");
      setRunErrorDetail("");
      setAuditError("");

      const signer = await createSigner();
      const loaded = await (registryLoad.current ??= loadToolRegistry());
      setRegistry(loaded);
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
          ? createLivePlanner(OPS_AGENT, `You are assigned ticket #${ticketId}. Handle it.`)
          : createRecordedPlanner(ticket482Run, "Recorded run finished. Each step shows what actually ran.");
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
          if (live()) {
            updateStep(index, {
              phase: "error",
              error: "Edge Guard could not get a risk assessment, so the call did not run.",
              errorDetail: caught instanceof Error ? caught.message : undefined,
            });
          }
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
          updateStep(index, { approvedBy: `${APPROVER.name}, ${APPROVER.role}` });
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
          setRunError("The cloud planner could not be reached, so the agent stopped.");
          setRunErrorDetail(caught instanceof Error ? caught.message : "");
        }
      } finally {
        if (live()) {
          setPlanning(false);
          setRunning(false);
        }
      }
    },
    [updateStep],
  );

  return { world, steps, running, planning, finalText, runError, runErrorDetail, registry, auditError, run, reset, decide };
}
