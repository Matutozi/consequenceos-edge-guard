import { useEffect, useMemo, useState } from "react";
import { Download, LoaderCircle, RotateCcw } from "lucide-react";
import { canonicalJson } from "../../domain/receipt";
import { parsePolicy, type PolicyConfig } from "../../domain/policyConfig";
import type { BlastRadius, DataSensitivity } from "../../domain/types";
import { baselineAssessments, loadLastRun } from "../../evals/assessmentStore";
import { previewDraft, summarizePreview, type AssessmentSet, type PolicyDraft, type PreviewRow } from "../../evals/preview";
import type { ToolMeta } from "../../ops/registry";
import { DOMAINS_PARAM, loadToolRegistry, parseDomains, POLICY_PARAM, REGISTRY_PARAM, type LoadedRegistry } from "../../ops/registryConfig";
import { decisionBadge, decisionLabel } from "../format";

const DRAFT_KEY = "edge-guard-policy-draft";
const DATA: DataSensitivity[] = ["public", "internal", "confidential", "restricted"];
const IMPACT: [BlastRadius, string][] = [
  ["single_user", "One person"],
  ["team", "One team"],
  ["organization", "Whole organization"],
  ["public", "People outside the company"],
];

const FLOOR = [
  "Restricted data that cannot be undone is blocked.",
  "A tool that is not in the registry is treated as restricted and irreversible, so it is blocked.",
  "Each tool's egress setting applies to destinations outside the internal domains.",
  "No cloud model sees a call on confidential or restricted data.",
  "If the assessor can't run or doesn't answer in time, a person decides.",
  "A call whose reason or arguments speak to the assessor (naming it, or telling it what to rate) goes to a person.",
];

function loadDraft(): PolicyDraft | undefined {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as PolicyDraft) : undefined;
  } catch {
    return undefined;
  }
}

function saveDraft(draft: PolicyDraft | undefined) {
  try {
    if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage unavailable: the draft lasts until the page closes.
  }
}

const fromLive = (live: LoadedRegistry): PolicyDraft => ({
  registry: live.registry,
  internalDomains: live.internalDomains,
  policy: live.policy,
});

function templateFor(draft: PolicyDraft) {
  const param = (value: unknown, description: string) => ({ defaultValue: { value: JSON.stringify(value) }, description, valueType: "JSON" });
  return {
    parameters: {
      [REGISTRY_PARAM]: param(draft.registry, "Edge Guard tool registry."),
      [POLICY_PARAM]: param(draft.policy, "Edge Guard's adjustable thresholds."),
      [DOMAINS_PARAM]: param(draft.internalDomains, "Domains inside the organization."),
    },
  };
}

/** Edit a draft policy and test it against the evals. Publishing happens outside this page. */
export default function PolicyPage() {
  const [live, setLive] = useState<LoadedRegistry>();
  const [draft, setDraft] = useState<PolicyDraft | undefined>(loadDraft);
  const [domainsText, setDomainsText] = useState("");
  const [domainsError, setDomainsError] = useState("");
  const lastRun = useMemo(loadLastRun, []);
  const baselineReady = Object.keys(baselineAssessments.assessments).length > 0;
  const [source, setSource] = useState<"baseline" | "last-run">(baselineReady || !lastRun ? "baseline" : "last-run");

  useEffect(() => {
    void loadToolRegistry().then((loaded) => {
      setLive(loaded);
      setDraft((current) => current ?? fromLive(loaded));
    });
  }, []);

  useEffect(() => {
    if (draft) setDomainsText(draft.internalDomains.join("\n"));
    // Only when a draft is first loaded or reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft === undefined]);

  function update(next: PolicyDraft) {
    setDraft(next);
    saveDraft(next);
  }

  function setPolicy<K extends keyof PolicyConfig>(key: K, value: PolicyConfig[K]) {
    if (draft) update({ ...draft, policy: { ...draft.policy, [key]: value } });
  }

  function setTool(name: string, change: Partial<ToolMeta>) {
    if (!draft) return;
    const next: ToolMeta = { ...draft.registry[name], ...change };
    // Keep the registry JSON clean: drop optional fields that are switched off.
    if (next.egress === undefined) delete next.egress;
    if (next.fanout === undefined) delete next.fanout;
    if (!next.lowImpact) delete next.lowImpact;
    update({ ...draft, registry: { ...draft.registry, [name]: next } });
  }

  function setDomains(text: string) {
    setDomainsText(text);
    if (!draft) return;
    try {
      const domains = parseDomains(JSON.stringify(text.split(/[\s,]+/).filter(Boolean)));
      setDomainsError("");
      update({ ...draft, internalDomains: domains });
    } catch (caught) {
      setDomainsError(caught instanceof Error ? caught.message : "Not a valid domain list.");
    }
  }

  function reset() {
    if (!live) return;
    saveDraft(undefined);
    setDraft(fromLive(live));
    setDomainsText(live.internalDomains.join("\n"));
    setDomainsError("");
  }

  const assessmentSet: AssessmentSet | undefined = source === "last-run" ? lastRun : baselineReady ? baselineAssessments : undefined;
  const liveRows = useMemo(() => (live ? previewDraft(fromLive(live), assessmentSet?.assessments ?? {}) : []), [live, assessmentSet]);
  const draftRows = useMemo(() => (draft ? previewDraft(draft, assessmentSet?.assessments ?? {}) : []), [draft, assessmentSet]);

  if (!live || !draft) {
    return (
      <div className="page">
        <div className="state"><LoaderCircle className="spin" size={13} aria-hidden="true" /> Loading the live policy</div>
      </div>
    );
  }

  const changed = canonicalJson(draft) !== canonicalJson(fromLive(live));
  const liveSummary = summarizePreview(liveRows);
  const draftSummary = summarizePreview(draftRows);
  const newFalseAllows = draftRows.filter((r, i) => r.verdict === "false-allow" && liveRows[i]?.verdict !== "false-allow");
  const differences = draftRows
    .map((r, i) => ({ draft: r, live: liveRows[i] }))
    .filter(({ draft: d, live: l }) => d.decision !== l?.decision || d.verdict !== l?.verdict);
  const policyCheck = parsePolicy(draft.policy);
  const exportText = JSON.stringify(templateFor(draft), null, 2);

  function download() {
    const url = URL.createObjectURL(new Blob([`${exportText}\n`], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "remoteconfig.template.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div className="page policy-page">
      <div className="page-header">
        <h1>Policy</h1>
        <p>
          Edit a draft of Edge Guard's rules and test it against the evals before anyone publishes it.
          This page never changes the live rules: publishing happens in the Firebase console or with the
          CLI, by someone with access to the project.
        </p>
      </div>

      <section className="card">
        <div className="card-header">
          Draft
          <span className="presets">
            <span className="quiet">
              {changed ? "Differs from the live policy" : "Same as the live policy"}. Live:{" "}
              {live.source === "remote-config" ? "Firebase Remote Config" : "bundled with the app"}
              {live.policyTightened.length ? `, ${live.policyTightened.length} fields tightened` : ""}.
            </span>
            <button type="button" className="btn btn-sm" onClick={reset} disabled={!changed}>
              <RotateCcw size={13} aria-hidden="true" /> Reset to live
            </button>
          </span>
        </div>
        <div className="card-body policy-grid">
          <fieldset className="policy-fields">
            <legend>Thresholds</legend>
            <label className="field">
              Block at risk
              <select value={draft.policy.blockAtRisk} onChange={(e) => setPolicy("blockAtRisk", e.target.value as PolicyConfig["blockAtRisk"])}>
                <option value="critical">Critical</option>
                <option value="high">High and above</option>
              </select>
            </label>
            <label className="field">
              A person approves from risk
              <select value={draft.policy.approvalAtRisk} onChange={(e) => setPolicy("approvalAtRisk", e.target.value as PolicyConfig["approvalAtRisk"])}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low (everything)</option>
              </select>
            </label>
            <label className="field">
              Actions that can't be undone run without approval up to
              <select value={draft.policy.irreversibleAllowedUpTo} onChange={(e) => setPolicy("irreversibleAllowedUpTo", e.target.value as PolicyConfig["irreversibleAllowedUpTo"])}>
                <option value="none">Never (always a person)</option>
                <option value="low">Low risk</option>
                <option value="medium">Medium risk</option>
              </select>
            </label>
            <label className="field">
              Assessor timeout, seconds
              <input
                type="number"
                min={5}
                max={60}
                value={draft.policy.assessorTimeoutSeconds}
                onChange={(e) => setPolicy("assessorTimeoutSeconds", Number(e.target.value))}
              />
            </label>
            <div className="field">
              Data that always needs a person
              <div className="checks-inline">
                {DATA.map((d) => (
                  <label key={d}>
                    <input
                      type="checkbox"
                      checked={draft.policy.approvalForData.includes(d)}
                      onChange={(e) => setPolicy("approvalForData", e.target.checked ? [...draft.policy.approvalForData, d] : draft.policy.approvalForData.filter((x) => x !== d))}
                    />{" "}
                    {d}
                  </label>
                ))}
              </div>
            </div>
            <div className="field">
              Impact that always needs a person
              <div className="checks-inline">
                {IMPACT.map(([value, text]) => (
                  <label key={value}>
                    <input
                      type="checkbox"
                      checked={draft.policy.approvalForImpact.includes(value)}
                      onChange={(e) => setPolicy("approvalForImpact", e.target.checked ? [...draft.policy.approvalForImpact, value] : draft.policy.approvalForImpact.filter((x) => x !== value))}
                    />{" "}
                    {text}
                  </label>
                ))}
              </div>
            </div>
            <div className="field">
              Allowed by rule, with no model call
              <div className="checks-inline">
                <label><input type="checkbox" checked={draft.policy.fastPathReads} onChange={(e) => setPolicy("fastPathReads", e.target.checked)} /> Reads</label>
                <label><input type="checkbox" checked={draft.policy.fastPathLowImpact} onChange={(e) => setPolicy("fastPathLowImpact", e.target.checked)} /> Low-impact changes</label>
              </div>
            </div>
            <label className="check-row" style={{ gridColumn: "1 / -1" }}>
              <span>
                Gemini Nano needs a cloud second opinion to allow
                <small>Off lets Nano allow alone. The on-device evals found it can be talked into allowing injected calls.</small>
              </span>
              <input
                type="checkbox"
                checked={draft.policy.secondOpinionForDeviceAllows}
                onChange={(e) => setPolicy("secondOpinionForDeviceAllows", e.target.checked)}
              />
            </label>
            <label className="field">
              Targets that mean everyone
              <input
                value={draft.policy.wildcardTargets.join(", ")}
                onChange={(e) => setPolicy("wildcardTargets", e.target.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))}
              />
            </label>
            <label className="field">
              Internal domains, one per line
              <textarea rows={2} value={domainsText} onChange={(e) => setDomains(e.target.value)} />
              {domainsError && <span className="text-deny">{domainsError}</span>}
            </label>
            {policyCheck.tightened.length > 0 && (
              <div className="notice notice-error" role="alert">
                These fields are not valid and would publish as their strictest value: {policyCheck.tightened.join(", ")}.
              </div>
            )}
          </fieldset>

          <div>
            <h3 className="policy-h3">The floor, not configurable</h3>
            <ul className="floor">{FLOOR.map((f) => <li key={f}>{f}</li>)}</ul>
          </div>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-header">Tools</div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr><th>Tool</th><th>Data</th><th>Can be undone</th><th>Read only</th><th>Low impact</th><th>Outside domains</th><th>Target argument</th></tr>
            </thead>
            <tbody>
              {Object.entries(draft.registry).map(([name, meta]) => (
                <ToolRow key={name} name={name} meta={meta} onChange={(change) => setTool(name, change)} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }} aria-live="polite" aria-label="Impact on the evals">
        <div className="card-header">
          Impact on the evals
          <select
            aria-label="Assessments to use"
            value={source}
            onChange={(e) => setSource(e.target.value as "baseline" | "last-run")}
            style={{ width: "auto" }}
          >
            <option value="baseline" disabled={!baselineReady}>
              {baselineReady ? `Published run (${baselineAssessments.model}, ${baselineAssessments.date})` : "Published run (not recorded yet)"}
            </option>
            <option value="last-run" disabled={!lastRun}>
              {lastRun ? `My last run (${lastRun.route}, ${lastRun.date})` : "My last run (none yet)"}
            </option>
          </select>
        </div>
        <div className="card-body">
          <p className="quiet" style={{ margin: 0 }}>
            Rules are re-run exactly. Judgement cases reuse the assessments the model gave in that run: the
            policy changes what is done with an assessment, not the assessment, so no model is called here.
            The preview applies policy to one assessment per case; it does not model the cloud second opinion
            on Gemini Nano's allows.
          </p>
          <Verdict changed={changed} newFalseAllows={newFalseAllows} draftNeeds={draftSummary.needsAssessment} hasAssessments={!!assessmentSet} />
          <div className="table-scroll">
            <table className="data" style={{ border: "1px solid var(--border)" }}>
              <thead><tr><th /><th className="num">Scored</th><th className="num">Exact match</th><th className="num">False allows</th><th className="num">Stricter</th><th className="num">Needs a model run</th></tr></thead>
              <tbody>
                {([["Live", liveSummary], ["Draft", draftSummary]] as const).map(([name, s]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td className="num">{s.scored}</td>
                    <td className="num">{s.scored ? `${Math.round((s.pass / s.scored) * 100)}%` : "n/a"}</td>
                    <td className={`num ${s.falseAllows ? "text-deny" : ""}`}>{s.falseAllows}</td>
                    <td className="num">{s.stricter}</td>
                    <td className="num">{s.needsAssessment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {differences.length > 0 && (
            <div className="table-scroll">
              <table className="data" style={{ border: "1px solid var(--border)" }}>
                <thead><tr><th>Case</th><th>Expected</th><th>Live</th><th>Draft</th><th>Why the draft decides this</th></tr></thead>
                <tbody>
                  {differences.map(({ draft: d, live: l }) => (
                    <tr key={d.case.id}>
                      <td className="mono">{d.case.id}<div className="quiet">{d.case.tool}</div></td>
                      <td>{decisionLabel[d.case.expected]}</td>
                      <td><Decision row={l} /></td>
                      <td className={d.verdict === "false-allow" ? "text-deny" : ""}><Decision row={d} /></td>
                      <td className="muted">{d.reason ?? (d.verdict === "needs-assessment" ? "Now needs the assessor, and this run has no assessment for it." : "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          Publish
          <button type="button" className="btn btn-sm" onClick={download}>
            <Download size={13} aria-hidden="true" /> Download remoteconfig.template.json
          </button>
        </div>
        <div className="card-body">
          <p style={{ margin: 0, fontSize: 13 }}>
            Someone with access to the Firebase project publishes the draft, either by replacing
            <code> remoteconfig.template.json</code> and running <code>npx firebase-tools deploy --only remoteconfig</code>,
            or by pasting each value below into the matching parameter in the Firebase console. The app validates
            what it loads, so a malformed value can only make Edge Guard stricter.
          </p>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 13 }}>Values for the Firebase console</summary>
            {[["tool_registry", draft.registry], ["guard_policy", draft.policy], ["internal_domains", draft.internalDomains]].map(([name, value]) => (
              <div key={name as string} style={{ marginTop: 8 }}>
                <div className="quiet mono">{name as string}</div>
                <pre className="code-block">{JSON.stringify(value)}</pre>
              </div>
            ))}
          </details>
        </div>
      </section>
    </div>
  );
}

function Decision({ row }: { row?: PreviewRow }) {
  if (!row) return null;
  if (!row.decision) return <span className="quiet">Needs a model run</span>;
  return <span className={decisionBadge[row.decision]}>{decisionLabel[row.decision]}</span>;
}

function Verdict({ changed, newFalseAllows, draftNeeds, hasAssessments }: { changed: boolean; newFalseAllows: PreviewRow[]; draftNeeds: number; hasAssessments: boolean }) {
  if (!changed) return <p className="verdict" style={{ margin: 0 }}>No changes yet. Edit the draft to see its effect.</p>;
  if (newFalseAllows.length > 0) {
    return (
      <p className="verdict bad" style={{ margin: 0 }}>
        Do not publish: this draft allows {newFalseAllows.length} {newFalseAllows.length === 1 ? "call" : "calls"} it should not ({newFalseAllows.map((r) => r.case.id).join(", ")}).
      </p>
    );
  }
  return (
    <p className={`verdict ${draftNeeds && hasAssessments ? "" : "ok"}`} style={{ margin: 0 }}>
      No new false allows{draftNeeds ? `, but ${draftNeeds} ${draftNeeds === 1 ? "case needs" : "cases need"} a model run to be sure` : ""}.
    </p>
  );
}

function ToolRow({ name, meta, onChange }: { name: string; meta: ToolMeta; onChange: (change: Partial<ToolMeta>) => void }) {
  return (
    <tr>
      <td className="mono">{name}<div className="quiet" style={{ fontFamily: "var(--font)" }}>{meta.system}</div></td>
      <td>
        <select aria-label={`${name} data`} value={meta.sensitivity} onChange={(e) => onChange({ sensitivity: e.target.value as DataSensitivity })}>
          {DATA.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </td>
      <td><input type="checkbox" aria-label={`${name} can be undone`} checked={meta.reversible} onChange={(e) => onChange({ reversible: e.target.checked })} /></td>
      <td><input type="checkbox" aria-label={`${name} read only`} checked={meta.readOnly} onChange={(e) => onChange({ readOnly: e.target.checked })} /></td>
      <td><input type="checkbox" aria-label={`${name} low impact`} checked={meta.lowImpact === true} onChange={(e) => onChange({ lowImpact: e.target.checked })} /></td>
      <td>
        <select
          aria-label={`${name} outside domains`}
          value={meta.egress?.outside ?? "none"}
          onChange={(e) => onChange({ egress: e.target.value === "none" ? undefined : { arg: meta.egress?.arg ?? "to", outside: e.target.value as "deny" | "escalate" } })}
        >
          <option value="none">No check</option>
          <option value="escalate">Needs approval</option>
          <option value="deny">Blocked</option>
        </select>
        {meta.egress && (
          <input aria-label={`${name} destination argument`} className="mono" style={{ marginTop: 4 }} value={meta.egress.arg} onChange={(e) => onChange({ egress: { ...meta.egress!, arg: e.target.value } })} />
        )}
      </td>
      <td>
        <input
          aria-label={`${name} target argument`}
          className="mono"
          placeholder="none"
          value={meta.fanout?.arg ?? ""}
          onChange={(e) => onChange({ fanout: e.target.value.trim() ? { arg: e.target.value.trim() } : undefined })}
        />
      </td>
    </tr>
  );
}

