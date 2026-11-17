import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CircleCheck,
  CircleMinus,
  CircleX,
  Database,
  Download,
  FileSearch,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  ShieldX,
  Swords,
} from "lucide-react";
import { canonicalJson } from "../domain/receipt";
import { receiptLog, type LoggedReceipt, type RunDoc } from "../ops/receiptLog";
import { allPassed, checkLoggedReceipt, type Check } from "../ops/verifyLogged";

interface Loaded {
  original: LoggedReceipt;
  run?: RunDoc;
}

const decisionLabel = { allow: "Allowed", require_approval: "Escalated", deny: "Blocked" } as const;
const decisionTone = { allow: "allow", require_approval: "review", deny: "deny" } as const;
const sourceLabel = {
  ON_DEVICE: "Gemini Nano · on device",
  IN_CLOUD: "Firebase AI Logic · cloud",
  NONE: "Policy only · no model",
  UNKNOWN: "Source unknown",
} as const;

/** A local copy with one field changed, to show what the checks catch. Never written anywhere. */
function tamper(doc: LoggedReceipt): { doc: LoggedReceipt; change: string } {
  const copy = JSON.parse(JSON.stringify(doc)) as LoggedReceipt;
  if (copy.receipt.decision.decision !== "allow") {
    const before = copy.receipt.decision.decision;
    copy.receipt.decision.decision = "allow";
    return { doc: copy, change: `Changed the decision from "${before}" to "allow".` };
  }
  const args = copy.receipt.toolCall?.args ?? {};
  const key = Object.keys(args)[0];
  if (key) {
    args[key] = "everyone";
    return { doc: copy, change: `Changed the call's ${key} argument to "everyone".` };
  }
  copy.outcome = "rejected";
  return { doc: copy, change: 'Changed the outcome to "rejected".' };
}

function download(doc: LoggedReceipt, run?: RunDoc) {
  const blob = new Blob([JSON.stringify({ ...doc, publicKey: run?.publicKey }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `edge-guard-receipt-${doc.receipt.id}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function VerifyPage({ receiptId }: { receiptId?: string }) {
  const [query, setQuery] = useState(receiptId ?? "");
  const [recent, setRecent] = useState<LoggedReceipt[]>();
  const [recentError, setRecentError] = useState("");
  const [loaded, setLoaded] = useState<Loaded>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tampered, setTampered] = useState<{ doc: LoggedReceipt; change: string }>();
  const [checks, setChecks] = useState<Check[]>();

  const loadRecent = useCallback(() => {
    setRecentError("");
    receiptLog.recent(20).then(setRecent, (caught: unknown) =>
      setRecentError(caught instanceof Error ? caught.message : "The audit log could not be read."),
    );
  }, []);

  useEffect(loadRecent, [loadRecent]);

  useEffect(() => {
    setQuery(receiptId ?? "");
    setTampered(undefined);
    if (!receiptId) {
      setLoaded(undefined);
      setChecks(undefined);
      setError("");
      return;
    }
    let current = true;
    setLoading(true);
    setError("");
    (async () => {
      const original = await receiptLog.getReceipt(receiptId);
      if (!original) throw new Error(`No receipt with ID ${receiptId} is in the audit log.`);
      const run = await receiptLog.getRun(original.runId);
      return { original, run };
    })().then(
      (result) => current && setLoaded(result),
      (caught: unknown) => {
        if (!current) return;
        setLoaded(undefined);
        setError(caught instanceof Error ? caught.message : "The receipt could not be read.");
      },
    ).finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [receiptId]);

  useEffect(() => {
    if (!loaded) return;
    let current = true;
    void checkLoggedReceipt(tampered?.doc ?? loaded.original, loaded.run).then((c) => current && setChecks(c));
    return () => {
      current = false;
    };
  }, [loaded, tampered]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const id = query.trim();
    if (id) window.location.hash = `#/verify/${encodeURIComponent(id)}`;
  }

  const shown = tampered?.doc ?? loaded?.original;
  const passed = checks ? allPassed(checks) : undefined;

  return (
    <main className="verify">
      <section className="console-hero">
        <div className="eyebrow"><Database size={14} /> Audit log · Cloud Firestore</div>
        <h1>Verify a receipt.</h1>
        <p>
          Every decision Edge Guard makes is signed, bound to one exact call and appended to an
          audit log no client can edit. Check any receipt from the log alone: its contents, its
          signature against the run's public key, its approval, and whether what happened matches
          what was decided.
        </p>
        <form className="verify-form" onSubmit={submit}>
          <input
            aria-label="Receipt ID"
            placeholder="Receipt ID, for example 3f2c…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" className="run-button"><FileSearch size={16} /> Verify</button>
        </form>
      </section>

      <section className="verify-grid">
        <aside className="sys-card recent-card" aria-label="Recent receipts">
          <h3>
            <Database size={15} /> Recent receipts
            <button type="button" className="icon-button" onClick={loadRecent} title="Refresh">
              <RotateCcw size={13} />
            </button>
          </h3>
          {recentError ? (
            <p className="sys-line">The audit log could not be read: {recentError}</p>
          ) : !recent ? (
            <p className="sys-line"><LoaderCircle className="spin" size={13} /> Loading…</p>
          ) : recent.length === 0 ? (
            <p className="sys-line">No receipts yet. Run the agent in the console to create some.</p>
          ) : (
            <ul className="recent-list">
              {recent.map((r) => (
                <li key={r.receipt.id}>
                  <a
                    href={`#/verify/${r.receipt.id}`}
                    aria-current={r.receipt.id === receiptId ? "true" : undefined}
                  >
                    <code>{r.receipt.toolCall?.tool ?? "unknown"}</code>
                    <span className={`decision-chip ${decisionTone[r.receipt.decision.decision]}`}>
                      {decisionLabel[r.receipt.decision.decision]}
                    </span>
                    <small>
                      {r.outcome}
                      {r.loggedAt ? ` · ${new Date(r.loggedAt).toLocaleString()}` : ""}
                    </small>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="verify-result" aria-live="polite">
          {loading ? (
            <div className="run-empty"><LoaderCircle className="spin" size={26} /><h3>Reading the audit log…</h3></div>
          ) : error ? (
            <div className="planner-card failed" role="alert"><ShieldX size={15} /><span>{error}</span></div>
          ) : !loaded || !shown ? (
            <div className="run-empty">
              <FileSearch size={30} />
              <h3>Pick a receipt</h3>
              <p>Choose one from the audit log, or paste a receipt ID from the agent console.</p>
            </div>
          ) : (
            <>
              <div className={`decision-banner ${passed === undefined ? "" : passed ? "allow" : "deny"}`}>
                <span>{passed === false ? <ShieldX size={24} /> : <ShieldCheck size={24} />}</span>
                <div>
                  <small>{tampered ? "TAMPERED LOCAL COPY" : "RECEIPT FROM THE AUDIT LOG"}</small>
                  <h3>
                    {passed === undefined ? "Checking…" : passed ? "Verified" : "Verification failed"}
                  </h3>
                </div>
              </div>

              {tampered && (
                <p className="tamper-note">
                  <Swords size={14} /> {tampered.change} Nothing was written: the audit log can't be
                  edited. This shows what the checks catch.
                </p>
              )}

              <dl className="receipt-facts">
                <div><dt>Call</dt><dd><code>{shown.receipt.toolCall ? `${shown.receipt.toolCall.tool}(${canonicalJson(shown.receipt.toolCall.args)})` : "none"}</code></dd></div>
                <div><dt>Agent</dt><dd>{shown.receipt.proposal.actor}</dd></div>
                <div>
                  <dt>Decision</dt>
                  <dd>
                    <span className={`decision-chip ${decisionTone[shown.receipt.decision.decision]}`}>
                      {decisionLabel[shown.receipt.decision.decision]}
                    </span>{" "}
                    {shown.receipt.decision.rationale[0]}
                  </dd>
                </div>
                <div><dt>Assessed by</dt><dd>{sourceLabel[shown.receipt.inferenceSource]}</dd></div>
                <div><dt>Outcome</dt><dd>{shown.outcome}</dd></div>
                <div><dt>Receipt</dt><dd><code>{shown.receipt.id}</code></dd></div>
                <div><dt>Logged</dt><dd>{shown.loggedAt ? new Date(shown.loggedAt).toLocaleString() : "unknown"}</dd></div>
              </dl>

              <ul className="check-list">
                {(checks ?? []).map((check) => (
                  <li key={check.id} className={check.status}>
                    {check.status === "pass" ? <CircleCheck size={17} /> : check.status === "fail" ? <CircleX size={17} /> : <CircleMinus size={17} />}
                    <span><strong>{check.label}</strong><small>{check.detail}</small></span>
                  </li>
                ))}
              </ul>

              <div className="verify-actions">
                {tampered ? (
                  <button type="button" className="ghost-button" onClick={() => setTampered(undefined)}>
                    <RotateCcw size={14} /> Restore the original
                  </button>
                ) : (
                  <button type="button" className="ghost-button" onClick={() => setTampered(tamper(loaded.original))}>
                    <Swords size={14} /> Tamper with it
                  </button>
                )}
                <button type="button" className="ghost-button" onClick={() => download(loaded.original, loaded.run)}>
                  <Download size={14} /> Download with public key
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
