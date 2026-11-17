import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useAgentRun, type PlannerMode, type StepState } from "../../agent/useAgentRun";
import { DeviceModelPanel } from "../../DeviceModelPanel";
import { INJECTED_INSTRUCTION, type NorthwindState } from "../../ops/northwind";
import { PLANNER_MODEL } from "../../ops/planner";
import type { LoadedRegistry } from "../../ops/registryConfig";
import { useDeviceModel } from "../../useDeviceModel";
import { canonicalJson } from "../../domain/receipt";
import { decisionBadge, decisionLabel, formatArgs, receiptRoute, truncate, wentToCloud } from "../format";
import { deleteManualTicket } from "../../intake/adapters/manual";
import { sourceLabel, type Ticket } from "../../intake";
import { useTicketQueue } from "../../intake/useTicketQueue";
import { GuardInspector } from "./GuardInspector";
import { PhonePairing } from "./PhonePairing";
import { TicketComposer } from "./TicketComposer";

/** The recorded attack replays a run on this ticket only. */
const RECORDED_TICKET_ID = "sample:482";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export default function ConsoleView() {
  const agent = useAgentRun();
  const deviceModel = useDeviceModel();
  const [mode, setMode] = useState<PlannerMode>("live");
  const queue = useTicketQueue();
  const [ticketId, setTicketId] = useState(RECORDED_TICKET_ID);
  const [composing, setComposing] = useState(false);
  const [selected, setSelected] = useState(0);
  const following = useRef(true);
  const [announcement, setAnnouncement] = useState("");
  const announced = useRef(0);

  const { steps, running, decide } = agent;
  const waiting = steps.findIndex((s) => s.phase === "awaiting");

  // Follow the newest step until the viewer picks one; always jump to a step waiting for approval.
  useEffect(() => {
    if (waiting >= 0) setSelected(waiting);
    else if (following.current && steps.length > 0) setSelected(steps.length - 1);
  }, [steps.length, waiting]);

  // Announce each decision once, for screen readers.
  useEffect(() => {
    const decided = steps.filter((s) => s.signed);
    if (decided.length > announced.current) {
      const latest = decided[decided.length - 1];
      setAnnouncement(
        `Step ${steps.indexOf(latest) + 1}, ${latest.plan.call.tool}: ${decisionLabel[latest.signed!.receipt.decision.decision]}.`,
      );
    }
    announced.current = decided.length;
  }, [steps]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (event.key === "j" || event.key === "k") {
        if (steps.length === 0) return;
        following.current = false;
        setSelected((i) => Math.min(steps.length - 1, Math.max(0, i + (event.key === "j" ? 1 : -1))));
      } else if ((event.key === "a" || event.key === "r") && waiting >= 0) {
        decide(event.key === "a");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps.length, waiting, decide]);

  function start() {
    following.current = true;
    setSelected(0);
    announced.current = 0;
    void agent.run({
      mode,
      ticketNumber: ticket!.number,
      queue: queue.tickets.map(({ number, title, requester, body }) => ({ number, title, requester, body })),
    });
  }

  /** The timeline belongs to one ticket, so switching tickets clears it. */
  function selectTicket(id: string) {
    if (id !== ticketId && agent.steps.length > 0) agent.reset();
    setTicketId(id);
    setComposing(false);
  }

  function created(newTicket: Ticket) {
    selectTicket(newTicket.id);
  }

  function removeTicket(id: string) {
    deleteManualTicket(id);
    if (agent.steps.length > 0) agent.reset();
    setTicketId(RECORDED_TICKET_ID);
    queue.refresh();
  }

  function select(index: number) {
    following.current = false;
    setSelected(index);
  }

  const ticket = queue.tickets.find((t) => t.id === ticketId) ?? queue.tickets.find((t) => t.id === RECORDED_TICKET_ID);
  // Status and notes change as the agent works; the helpdesk copy in the run has them.
  const helpdesk = ticket ? agent.world.tickets.find((t) => t.id === ticket.number) : undefined;
  // Only the sample ticket's planted instruction is marked. Tickets people write show as written.
  const [ticketText, planted] =
    ticket?.source === "sample" && ticket.body.includes(INJECTED_INSTRUCTION)
      ? [ticket.body.split(INJECTED_INSTRUCTION)[0].replace(/\n*--- forwarded message ---\n*$/, ""), INJECTED_INSTRUCTION]
      : [ticket?.body ?? "", undefined];
  const recordedUnavailable = mode === "recorded" && ticketId !== RECORDED_TICKET_ID;
  const cloudChecks = steps.filter((s) => s.signed && wentToCloud(s.signed.receipt)).length;

  return (
    <div className="console">
      <div className="visually-hidden" aria-live="polite">{announcement}</div>

      <nav className="pane pane-queue" aria-label="Ticket queue">
        <div className="pane-header">
          Queue
          <button type="button" className="btn btn-sm" onClick={() => setComposing(true)} disabled={running}>
            <Plus size={13} aria-hidden="true" /> New ticket
          </button>
        </div>
        {queue.loading && queue.tickets.length === 0 ? (
          <div className="state"><LoaderCircle className="spin" size={13} aria-hidden="true" /> Loading tickets</div>
        ) : queue.tickets.length === 0 ? (
          <div className="state">No tickets. Write one with New ticket.</div>
        ) : (
          <ul className="queue-list">
            {queue.tickets.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="queue-item"
                  aria-current={t.id === ticketId && !composing ? "true" : undefined}
                  disabled={running}
                  onClick={() => selectTicket(t.id)}
                >
                  <span className="title">{t.title}</span>
                  <span className="meta">
                    <span className="source">{sourceLabel[t.source]}</span> #{t.number}, {t.priority} priority
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {queue.errors.map((e) => <p key={e} className="state state-error">{e}</p>)}
      </nav>

      <main className="pane pane-main" aria-label="Northwind ops">
        {composing ? (
          <TicketComposer onCreated={created} onCancel={() => setComposing(false)} />
        ) : !ticket ? (
          <div className="state"><LoaderCircle className="spin" size={13} aria-hidden="true" /> Loading the ticket</div>
        ) : (
        <>
        <header className="ticket">
          <h1>{ticket.title}</h1>
          <div className="meta">
            Ticket #{ticket.number} from {ticket.requester}. {sourceLabel[ticket.source]}, {ticket.priority} priority, {helpdesk?.status ?? "open"}.
            {ticket.source === "manual" && !running && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeTicket(ticket.id)}>
                <Trash2 size={13} aria-hidden="true" /> Delete
              </button>
            )}
          </div>
          <p className="ticket-body">{ticketText.trim()}</p>
          {planted && (
            <p className="planted">
              <strong>Hidden instruction in the ticket body</strong>
              {planted}
            </p>
          )}
          {helpdesk?.notes.map((note) => <p key={note} className="ticket-body">Note: {note}</p>)}
        </header>

        <div className="runbar">
          <div className="segmented" role="radiogroup" aria-label="Planner">
            <button type="button" role="radio" aria-checked={mode === "live"} disabled={running} onClick={() => setMode("live")}>
              Live planner
            </button>
            <button type="button" role="radio" aria-checked={mode === "recorded"} disabled={running} onClick={() => setMode("recorded")}>
              Recorded attack
            </button>
          </div>
          <button type="button" className="btn btn-primary" onClick={start} disabled={running || recordedUnavailable || deviceModel.preparing}>
            {running ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            {running ? "Running" : steps.length ? "Run again" : "Run agent"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={agent.reset} disabled={steps.length === 0 && !running}>
            <RotateCcw size={14} aria-hidden="true" /> Reset
          </button>
          <span className="quiet">
            {recordedUnavailable
              ? "The recorded attack exists only for sample ticket #482. Pick it or use the live planner."
              : mode === "live"
                ? `The planner is ${PLANNER_MODEL} in the cloud, through Firebase AI Logic. It chooses its own steps.`
                : "Replays a run where the agent followed the hidden instruction. Edge Guard decides each step live."}
          </span>
        </div>

        <section className="timeline" aria-label="Agent steps">
          <h2>Agent steps</h2>
          <ol className="steps">
            {steps.length === 0 && !running && (
              <li className="step-note">No steps yet. Run the agent to start.</li>
            )}
            {steps.map((step, index) => (
              <li key={index}>
                <StepRow step={step} index={index} selected={index === selected} onSelect={() => select(index)} />
              </li>
            ))}
            {agent.planning && (
              <li className="step-note">
                <LoaderCircle className="spin" size={13} aria-hidden="true" />
                {mode === "live" ? "The planner is choosing the next step in the cloud." : "Loading the next recorded step."}
              </li>
            )}
            {agent.finalText && <li className="step-note">Agent: {agent.finalText}</li>}
            {agent.runError && (
              <li className="step-note text-deny" role="alert" title={agent.runErrorDetail || undefined}>
                {agent.runError}
              </li>
            )}
          </ol>
          {cloudChecks > 0 && (
            <p className="quiet">
              {cloudChecks} {cloudChecks === 1 ? "check" : "checks"} went to the cloud: either Gemini Nano was not ready, or
              it would allow the call and the cloud gave a second opinion. Each sent only the tool name, arguments, the
              agent's reason and the registry description. Sensitive data never goes.
            </p>
          )}
        </section>

        <CompanyTabs world={agent.world} />
        </>
        )}
      </main>

      <GuardInspector
        step={steps[selected]}
        index={selected}
        total={steps.length}
        registry={agent.registry}
        onDecide={decide}
      >
        <DeviceModelPanel model={deviceModel} disabled={running} />
        <p className="quiet" title={agent.registry?.fallbackReason}>Registry: {registryLine(agent.registry)}</p>
        <PhonePairing disabled={running} />
        <p className="quiet" title={agent.auditError || undefined}>
          Audit log: {agent.auditError ? "not recording, Firestore is unavailable" : "Cloud Firestore"}
        </p>
        <p className="shortcuts">
          <span><kbd>j</kbd> <kbd>k</kbd> move between steps</span>
          <span><kbd>a</kbd> approve</span>
          <span><kbd>r</kbd> reject</span>
        </p>
      </GuardInspector>
    </div>
  );
}

function StepRow({ step, index, selected, onSelect }: { step: StepState; index: number; selected: boolean; onSelect: () => void }) {
  const receipt = step.signed?.receipt;
  const outcome =
    step.phase === "executed"
      ? `Ran. ${step.output ?? ""}`
      : step.phase === "refused"
        ? "Executor refused it."
        : step.phase === "rejected"
          ? "Rejected by a person."
          : step.phase === "error"
            ? `Not run. ${step.error ?? ""}`
            : step.phase === "awaiting"
              ? "Waiting for approval."
              : "";
  return (
    <button type="button" className="step" aria-current={selected ? "true" : undefined} onClick={onSelect}>
      <span className="n">{index + 1}</span>
      <span className="call" title={`${step.plan.call.tool}(${canonicalJson(step.plan.call.args)})`}>
        {step.plan.call.tool}({formatArgs(step.plan.call.args, 28)})
      </span>
      <span className="status">
        {receipt ? (
          <span className={decisionBadge[receipt.decision.decision]}>{decisionLabel[receipt.decision.decision]}</span>
        ) : step.phase === "error" ? (
          <span className="text-deny">Not run</span>
        ) : (
          <>
            <LoaderCircle className="spin" size={13} aria-hidden="true" /> Checking
          </>
        )}
      </span>
      <span className="line">
        {[receipt && receiptRoute(receipt, step.ms), truncate(outcome, 120)].filter(Boolean).join(". ")}
      </span>
    </button>
  );
}

function registryLine(registry?: LoadedRegistry): string {
  if (!registry) return "loading";
  if (registry.source === "remote-config") {
    const rejected = registry.rejected.length ? `, ${registry.rejected.length} rejected` : "";
    return `Firebase Remote Config, ${Object.keys(registry.registry).length} tools${rejected}`;
  }
  return registry.fallbackReason?.includes("no tool_registry")
    ? "bundled with the app (not published to Remote Config yet)"
    : "bundled with the app (Remote Config unreachable)";
}

type Tab = "directory" | "customers" | "audit" | "outbox";

function CompanyTabs({ world }: { world: NorthwindState }) {
  const [tab, setTab] = useState<Tab>("directory");
  const tabs: [Tab, string][] = [
    ["directory", "Directory"],
    ["customers", "Customer records"],
    ["audit", `Audit log (${world.auditLog.length})`],
    ["outbox", `Outbox (${world.outbox.length})`],
  ];
  return (
    <section className="company" aria-label="Northwind systems">
      <div className="tabs" role="tablist" aria-label="Northwind systems">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="tab-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "directory" && (
          <table className="data">
            <thead><tr><th>Name</th><th>Role</th><th>Status</th><th className="num">Sessions</th></tr></thead>
            <tbody>
              {world.users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}<div className="quiet mono">{u.id}</div></td>
                  <td>{u.role}</td>
                  <td className={u.status === "disabled" ? "status-text-disabled" : ""}>{u.status === "disabled" ? "Disabled" : "Active"}</td>
                  <td className="num">{u.sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "customers" && (
          <table className="data">
            <thead><tr><th>Table</th><th className="num">Records</th><th>Exports</th></tr></thead>
            <tbody>
              <tr>
                <td>customers</td>
                <td className="num">{world.customerCount.toLocaleString("en-US")}</td>
                <td className={world.exports.length ? "text-deny" : ""}>{world.exports.length ? world.exports.join(", ") : "None"}</td>
              </tr>
            </tbody>
          </table>
        )}
        {tab === "audit" &&
          (world.auditLog.length === 0 ? (
            <div className="state">Nothing has run yet. Each action the executor runs is listed here with its receipt.</div>
          ) : (
            <table className="data">
              <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Receipt</th></tr></thead>
              <tbody>
                {world.auditLog.map((e) => (
                  <tr key={e.receiptId}>
                    <td className="quiet">{new Date(e.at).toLocaleTimeString()}</td>
                    <td>{e.actor}</td>
                    <td className="mono">{e.action}</td>
                    <td><a className="mono" href={`#/verify/${e.receiptId}`}>{e.receiptId.slice(0, 8)}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        {tab === "outbox" &&
          (world.outbox.length === 0 ? (
            <div className="state">No email sent.</div>
          ) : (
            <table className="data">
              <thead><tr><th>To</th><th>Subject</th></tr></thead>
              <tbody>
                {world.outbox.map((m) => (
                  <tr key={m.subject + m.to}><td>{m.to}</td><td>{m.subject}</td></tr>
                ))}
              </tbody>
            </table>
          ))}
      </div>
    </section>
  );
}
