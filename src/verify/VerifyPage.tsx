import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
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
import { approvalStore, type ApproverDoc } from "../ops/approvals";
import { receiptLog, type LoggedReceipt, type RunDoc } from "../ops/receiptLog";
import {
  allPassed,
  checkLoggedReceipt,
  checkPastedReceipt,
  resolveLogEntry,
  type Check,
  type PastedCheck,
} from "../ops/verifyLogged";
import { decisionBadge, decisionLabel, receiptRoute } from "../ui/format";

interface Loaded {
  original: LoggedReceipt;
  run?: RunDoc;
  /** The phone's registered key, when a phone signed the approval. */
  approver?: ApproverDoc;
  /** Other runs with a validly signed entry for the same receipt ID. */
  rivalRuns: string[];
  /** Entries for this receipt ID that failed verification and were set aside. */
  ignored: number;
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
      const resolved = await resolveLogEntry(await receiptLog.getEntries(receiptId), auditLookup);
      if (!resolved) throw new Error(`No receipt with ID ${receiptId} is in the audit log.`);
      const { doc, ...rest } = resolved;
      return { original: doc as LoggedReceipt, ...rest };
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
    void checkLoggedReceipt(tampered?.doc ?? loaded.original, loaded.run, loaded.approver, loaded.rivalRuns).then(
      (c) => current && setChecks(c),
    );
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
                {!tampered && loaded.ignored > 0 && (
                  <div className="notice notice-review">
                    The log holds {loaded.ignored} other {loaded.ignored === 1 ? "entry" : "entries"} for this receipt that{" "}
                    {loaded.ignored === 1 ? "does" : "do"} not verify. Anyone can append to the log, so{" "}
                    {loaded.ignored === 1 ? "it was" : "they were"} set aside; only an entry signed by the run's key counts.
                  </div>
                )}
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
                  <dd>
                    {receiptRoute(shown.receipt)}
                    {shown.receipt.secondOpinion?.decision && (
                      <span className="quiet"> (Gemini Nano: allow; cloud: {decisionLabel[shown.receipt.secondOpinion.decision].toLowerCase()})</span>
                    )}
                  </dd>
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

      <PasteVerify />
    </div>
  );
}

function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="checks">
      {checks.map((check) => (
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
  );
}

const auditLookup = {
  run: (runId: string) => receiptLog.getRun(runId),
  approver: (keyId: string) => approvalStore.getApprover(keyId),
  receipt: (id: string) => receiptLog.getEntries(id),
};

/** Checks a receipt file someone pasted or uploaded, against the audit log where it can. */
function PasteVerify() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<PastedCheck>();
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  async function check(source = text) {
    setChecking(true);
    setError("");
    setResult(undefined);
    try {
      setResult(await checkPastedReceipt(source, auditLookup));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The receipt could not be checked.");
    } finally {
      setChecking(false);
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 512 * 1024) {
      setError("That file is larger than 512 KB, which is too big for a receipt.");
      return;
    }
    const content = await file.text();
    setText(content);
    void check(content);
  }

  const passed = result ? allPassed(result.checks) : undefined;

  return (
    <section className="card" style={{ marginTop: 16 }} aria-label="Check a receipt file">
      <div className="card-header">Check a receipt file</div>
      <div className="card-body">
        <p style={{ margin: 0, fontSize: 13 }} className="muted">
          Paste a receipt's JSON or upload the file, for example one downloaded above or from the single
          action view. A signature only proves where a receipt came from when the key comes from the audit
          log, so a key inside the file is never trusted on its own.
        </p>
        <label className="field">
          Receipt JSON
          <textarea rows={6} className="mono" value={text} onChange={(e) => { setText(e.target.value); setResult(undefined); setError(""); }} />
        </label>
        <div className="presets">
          <button type="button" className="btn btn-primary btn-sm" disabled={!text.trim() || checking} onClick={() => void check()}>
            {checking && <LoaderCircle className="spin" size={13} aria-hidden="true" />} Check
          </button>
          <label className="btn btn-sm">
            Upload a file
            <input type="file" accept="application/json,.json" className="visually-hidden" onChange={(e) => void upload(e)} />
          </label>
        </div>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {result && (
          <div aria-live="polite">
            <p className={`verdict ${passed ? "ok" : "bad"}`} style={{ margin: "0 0 8px" }}>
              {passed ? <ShieldCheck size={16} aria-hidden="true" /> : <ShieldX size={16} aria-hidden="true" />}
              {result.kind === "digest-only"
                ? passed ? "Digest matches. Not signed." : "Changed after it was issued"
                : passed ? "Verified against the audit log" : "Not verified"}
            </p>
            <CheckList checks={result.checks} />
          </div>
        )}
      </div>
    </section>
  );
}
