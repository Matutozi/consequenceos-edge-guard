import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CircleCheck,
  CircleMinus,
  CircleX,
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
import { decisionBadge, decisionLabel, routeLine } from "../ui/format";

interface Loaded {
  original: LoggedReceipt;
  run?: RunDoc;
}


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
    <div className="page">
      <div className="page-header">
        <h1>Verify a receipt</h1>
        <p>
          Each decision is signed, bound to one exact call and appended to an audit log in Cloud
          Firestore that no client can edit. Pick a receipt to check its contents, its signature
          against the run's public key, its approval, and whether what happened matches the decision.
        </p>
        <form className="verify-form" onSubmit={submit}>
          <input
            aria-label="Receipt ID"
            placeholder="Receipt ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" className="btn btn-primary"><FileSearch size={14} aria-hidden="true" /> Verify</button>
        </form>
      </div>

      <div className="verify-grid">
        <section className="card" aria-label="Recent receipts">
          <div className="card-header">
            Recent receipts
            <button type="button" className="btn btn-ghost btn-sm" onClick={loadRecent}>
              <RotateCcw size={13} aria-hidden="true" /> Refresh
            </button>
          </div>
          {recentError ? (
            <div className="state state-error"><strong>Could not read the audit log</strong>{recentError}</div>
          ) : !recent ? (
            <div className="state"><LoaderCircle className="spin" size={13} aria-hidden="true" /> Loading receipts</div>
          ) : recent.length === 0 ? (
            <div className="state">No receipts yet. Run the agent in the console to create some.</div>
          ) : (
            <ul className="receipt-list">
              {recent.map((r) => (
                <li key={r.receipt.id}>
                  <a href={`#/verify/${r.receipt.id}`} aria-current={r.receipt.id === receiptId ? "true" : undefined}>
                    <code>{r.receipt.toolCall?.tool ?? "unknown"}</code>
                    <span className={decisionBadge[r.receipt.decision.decision]}>{decisionLabel[r.receipt.decision.decision]}</span>
                    <small>
                      {r.outcome[0].toUpperCase() + r.outcome.slice(1)}
                      {r.loggedAt ? `, ${new Date(r.loggedAt).toLocaleString()}` : ""}
                    </small>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-live="polite" aria-label="Verification">
          {loading ? (
            <div className="state"><LoaderCircle className="spin" size={13} aria-hidden="true" /> Reading the audit log</div>
          ) : error ? (
            <div className="state state-error" role="alert"><strong>Receipt not found</strong>{error}</div>
          ) : !loaded || !shown ? (
            <div className="state"><strong>No receipt selected</strong>Choose one from the list, or paste a receipt ID.</div>
          ) : (
            <>
              <div className="card-header">
                <span className={`verdict ${passed === undefined ? "" : passed ? "ok" : "bad"}`}>
                  {passed === false ? <ShieldX size={16} aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}
                  {passed === undefined ? "Checking" : passed ? "Verified" : "Verification failed"}
                </span>
                <span className="quiet">{tampered ? "Tampered local copy" : "From the audit log"}</span>
              </div>
              <div className="card-body">
                {tampered && (
                  <div className="notice notice-review">
                    {tampered.change} Nothing was written: the audit log can't be edited. This shows what the checks catch.
                  </div>
                )}
                <dl className="facts">
                  <dt>Call</dt>
                  <dd className="mono">{shown.receipt.toolCall ? `${shown.receipt.toolCall.tool}(${canonicalJson(shown.receipt.toolCall.args)})` : "None"}</dd>
                  <dt>Agent</dt>
                  <dd>{shown.receipt.proposal.actor}</dd>
                  <dt>Decision</dt>
                  <dd>
                    <span className={decisionBadge[shown.receipt.decision.decision]}>{decisionLabel[shown.receipt.decision.decision]}</span>{" "}
                    {shown.receipt.decision.rationale[0]}
                  </dd>
                  <dt>Route</dt>
                  <dd>{routeLine(shown.receipt.inferenceSource)}</dd>
                  <dt>Outcome</dt>
                  <dd>{shown.outcome[0].toUpperCase() + shown.outcome.slice(1)}</dd>
                  <dt>Receipt</dt>
                  <dd className="mono">{shown.receipt.id}</dd>
                  <dt>Logged</dt>
                  <dd>{shown.loggedAt ? new Date(shown.loggedAt).toLocaleString() : "Unknown"}</dd>
                </dl>
                <ul className="checks">
                  {(checks ?? []).map((check) => (
                    <li key={check.id} className={check.status}>
                      {check.status === "pass" ? (
                        <CircleCheck size={16} aria-label="Passed" />
                      ) : check.status === "fail" ? (
                        <CircleX size={16} aria-label="Failed" />
                      ) : (
                        <CircleMinus size={16} aria-label="Not applicable" />
                      )}
                      <span>{check.label}<small>{check.detail}</small></span>
                    </li>
                  ))}
                </ul>
                <div className="presets">
                  {tampered ? (
                    <button type="button" className="btn btn-sm" onClick={() => setTampered(undefined)}>
                      <RotateCcw size={13} aria-hidden="true" /> Restore the original
                    </button>
                  ) : (
                    <button type="button" className="btn btn-sm" onClick={() => setTampered(tamper(loaded.original))}>
                      <Swords size={13} aria-hidden="true" /> Tamper with it
                    </button>
                  )}
                  <button type="button" className="btn btn-sm" onClick={() => download(loaded.original, loaded.run)}>
                    <Download size={13} aria-hidden="true" /> Download with public key
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
