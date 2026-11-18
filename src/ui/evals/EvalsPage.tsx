import { useRef, useState } from "react";
import { LoaderCircle, Play } from "lucide-react";
import { evalCases } from "../../evals/cases";
import { saveLastRun } from "../../evals/assessmentStore";
import { assessmentsFrom } from "../../evals/preview";
import { groupSummaries, runEvals, summarize, toMarkdown, type EvalResult, type EvalRoute, type Summary } from "../../evals/runEvals";
import { PLANNER_MODEL } from "../../ops/planner";
import { createSigner } from "../../ops/signing";
import { DeviceModelPanel } from "../../DeviceModelPanel";
import { useDeviceModel } from "../../useDeviceModel";
import { decisionLabel, duration } from "../format";

const verdictText: Record<EvalResult["verdict"], string> = {
  pass: "Pass",
  stricter: "Stricter",
  "false-allow": "False allow",
  "not-assessed": "Not assessed",
  error: "Error",
};

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "n/a");

/** Runs the evaluation set against one assessor route and reports false allows first. */
export default function EvalsPage() {
  const deviceModel = useDeviceModel();
  const [route, setRoute] = useState<EvalRoute>("cloud");
  const [results, setResults] = useState<EvalResult[]>([]);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [finishedAt, setFinishedAt] = useState<string>();
  const runId = useRef(0);

  const deviceReady = deviceModel.status === "available";
  const total = route === "rules" ? evalCases.filter((c) => c.byRule).length : evalCases.length;

  async function run() {
    const id = ++runId.current;
    setRunning(true);
    setResults([]);
    setCopied(false);
    setFinishedAt(undefined);
    const signer = await createSigner();
    const collected: EvalResult[] = [];
    await runEvals(evalCases, route, signer, {
      // One at a time: parallel cloud calls hit the API rate limit and distort timings.
      concurrency: route === "rules" ? 4 : 1,
      onResult: (result) => {
        if (runId.current !== id) return;
        collected.push(result);
        setResults([...collected]);
      },
    });
    if (runId.current === id) {
      setRunning(false);
      const date = new Date().toISOString().slice(0, 10);
      setFinishedAt(date);
      if (route !== "rules") {
        saveLastRun({
          route,
          model: route === "cloud" ? PLANNER_MODEL : route === "hybrid" ? `Gemini Nano, then ${PLANNER_MODEL}` : "Gemini Nano",
          date,
          assessments: assessmentsFrom(collected),
        });
      }
    }
  }

  async function copyMarkdown() {
    const ordered = [...results].sort((a, b) => a.case.id.localeCompare(b.case.id));
    const text = toMarkdown(ordered, route, {
      date: finishedAt ?? new Date().toISOString().slice(0, 10),
      model: route === "cloud" ? PLANNER_MODEL : route === "device" ? "Gemini Nano" : route === "hybrid" ? `Gemini Nano, then ${PLANNER_MODEL}` : undefined,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const groups = groupSummaries(results);
  const all = summarize(results);
  const ordered = [...results].sort((a, b) => a.case.id.localeCompare(b.case.id));

  return (
    <div className="page">
      <div className="page-header">
        <h1>Evals</h1>
        <p>
          {evalCases.length} guarded tool calls with the decision each should get: {evalCases.filter((c) => c.byRule).length}{" "}
          decided by rules and {evalCases.filter((c) => !c.byRule).length} that need the assessor's judgement, including{" "}
          {evalCases.filter((c) => c.category === "injection").length} injection attempts. A false allow, where Edge
          Guard was more permissive than it should be, is the failure that matters most.
        </p>
      </div>

      <section className="card">
        <div className="card-body">
          <div className="presets" role="radiogroup" aria-label="Route">
            <div className="segmented">
              <button type="button" role="radio" aria-checked={route === "hybrid"} disabled={running || !deviceReady} onClick={() => setRoute("hybrid")}>
                Hybrid
              </button>
              <button type="button" role="radio" aria-checked={route === "device"} disabled={running || !deviceReady} onClick={() => setRoute("device")}>
                On device only
              </button>
              <button type="button" role="radio" aria-checked={route === "cloud"} disabled={running} onClick={() => setRoute("cloud")}>
                Cloud
              </button>
              <button type="button" role="radio" aria-checked={route === "rules"} disabled={running} onClick={() => setRoute("rules")}>
                Rules only
              </button>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={running}>
              {running ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
              {running ? `Running, ${results.length} of ${total}` : `Run ${total} cases`}
            </button>
            {results.length > 0 && !running && (
              <button type="button" className="btn" onClick={() => void copyMarkdown()}>
                {copied ? "Copied" : "Copy results as Markdown"}
              </button>
            )}
            {results.length > 0 && !running && route !== "rules" && (
              <a className="btn" href="#/policy">Test a policy change with these results</a>
            )}
          </div>
          <p className="quiet" style={{ margin: 0 }}>
            {route === "cloud"
              ? `Every judgement case is assessed by ${PLANNER_MODEL} through Firebase AI Logic, including confidential ones. In the product, no cloud model sees a call on sensitive data; the evals send them, and the data is synthetic. Cases run one at a time.`
              : route === "device"
                ? "Every judgement case is assessed by Gemini Nano alone, with no second opinion. This measures the on-device model by itself."
                : route === "hybrid"
                  ? "The product's behaviour with Gemini Nano ready: Nano assesses on this device and can escalate or block alone; before any allow on public or internal data, the cloud gives a second opinion and the stricter answer wins."
                : "Only the cases decided by rules. No model is called; these must pass every time."}
          </p>
          {!deviceReady && <DeviceModelPanel model={deviceModel} disabled={running} />}
        </div>
      </section>

      {results.length > 0 && (
        <section className="card" style={{ marginTop: 16 }} aria-live="polite" aria-label="Summary">
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr><th>Group</th><th className="num">Scored</th><th className="num">Exact match</th><th className="num">False allows</th><th className="num">Stricter</th><th className="num">Not assessed or errors</th><th className="num">Median time</th></tr>
              </thead>
              <tbody>
                {([["Decided by rules", groups.rules], ["Decided with the assessor", groups.model], ["Injection attempts", groups.injection], ["All", all]] as [string, Summary][]).map(([name, s]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td className="num">{s.scored}</td>
                    <td className="num">{pct(s.pass, s.scored)}</td>
                    <td className={`num ${s.falseAllow ? "text-deny" : ""}`}>{s.falseAllow}</td>
                    <td className="num">{s.stricter}</td>
                    <td className="num">{s.notAssessed + s.errors}</td>
                    <td className="num">{s.medianMs === undefined ? "" : duration(s.medianMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {results.length > 0 && (
        <section className="card" style={{ marginTop: 16 }} aria-label="Cases">
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr><th>Case</th><th>Call</th><th>Expected</th><th>Actual</th><th>Verdict</th><th className="num">Time</th></tr>
              </thead>
              <tbody>
                {ordered.map((r) => (
                  <tr key={r.case.id}>
                    <td className="mono">{r.case.id}<div className="quiet">{r.case.category}</div></td>
                    <td><span className="mono">{r.case.tool}</span><div className="quiet">{r.case.why}</div></td>
                    <td>{decisionLabel[r.case.expected]}</td>
                    <td>{r.actual ? decisionLabel[r.actual] : ""}<div className="quiet">{r.error ?? r.reason ?? ""}</div></td>
                    <td className={r.verdict === "false-allow" || r.verdict === "error" ? "text-deny" : r.verdict === "pass" ? "" : "muted"}>
                      {verdictText[r.verdict]}
                    </td>
                    <td className="num">{r.ms === undefined ? "" : duration(r.ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
