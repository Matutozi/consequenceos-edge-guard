import { ticketSources, type TicketSource } from "../../intake";
import { webhookExample, webhookSchema, WEBHOOK_PATH } from "../../intake/adapters/webhook";

const statusText: Record<TicketSource["status"], string> = {
  available: "Available",
  not_connected: "Not connected",
  planned: "Planned",
};

/** Every ticket source and its honest status. Planned sources show how they would map and authenticate. */
export default function IntegrationsPage({ sourceId }: { sourceId?: string }) {
  const selected = ticketSources.find((s) => s.id === sourceId);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Integrations</h1>
        <p>
          Where tickets come from. Each source is an adapter that turns its payload into one ticket
          shape, so adding a source does not touch the agent or Edge Guard. Only Manual and Sample
          work today; the rest are planned and show how they would map and authenticate.
        </p>
      </div>

      <div className="card table-scroll">
        <table className="data">
          <thead>
            <tr><th>Source</th><th>Status</th><th>What it does</th><th aria-label="Details" /></tr>
          </thead>
          <tbody>
            {ticketSources.map((source) => (
              <tr key={source.id} aria-current={source.id === sourceId ? "true" : undefined}>
                <td style={{ whiteSpace: "nowrap", fontWeight: 500 }}>{source.name}</td>
                <td className={source.status === "available" ? "" : "quiet"} style={{ whiteSpace: "nowrap" }}>
                  {statusText[source.status]}
                </td>
                <td>{source.describe()}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {source.mapping && <a href={`#/integrations/${source.id}`}>View mapping</a>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sourceId && !selected && (
        <div className="notice notice-error" style={{ marginTop: 16 }} role="alert">No source called {sourceId}.</div>
      )}

      {selected?.mapping && (
        <section className="card" style={{ marginTop: 16 }} aria-label={`${selected.name} mapping`}>
          <div className="card-header">
            {selected.name}: field mapping
            <span className="quiet">{statusText[selected.status]}</span>
          </div>
          <div className="card-body">
            {selected.status === "planned" && (
              <p style={{ margin: 0, fontSize: 13 }} className="muted">
                {selected.id === "webhook" ? (
                  <>
                    The endpoint is not deployed. The contract and its normalizer are implemented and
                    tested in <code>src/intake/adapters/webhook.ts</code>.
                  </>
                ) : (
                  <>
                    Not connected. This mapping is implemented and tested in{" "}
                    <code>src/intake/adapters/{selected.id}.ts</code>; confirm field names against the
                    API version you connect to.
                  </>
                )}
              </p>
            )}
            <div className="table-scroll">
            <table className="data" style={{ border: "1px solid var(--border)" }}>
              <thead><tr><th>From the source</th><th>Ticket field</th><th>Notes</th></tr></thead>
              <tbody>
                {selected.mapping.map((m) => (
                  <tr key={m.from + m.to}>
                    <td className="mono">{m.from}</td>
                    <td className="mono">{m.to}</td>
                    <td className="muted">{m.note ?? ""}</td>
                  </tr>
                ))}
                <tr>
                  <td className="mono">the whole payload</td>
                  <td className="mono">raw</td>
                  <td className="muted">kept for audit, treated as untrusted</td>
                </tr>
              </tbody>
            </table>
            </div>
            {selected.auth && (
              <p style={{ margin: 0, fontSize: 13 }}>
                <strong style={{ fontWeight: 500 }}>Authentication: </strong>{selected.auth}
              </p>
            )}
            {selected.id === "webhook" && (
              <>
                <p style={{ margin: 0, fontSize: 13 }}>
                  Request: <code>POST {WEBHOOK_PATH}</code> with a JSON body like the example below. Titles,
                  bodies and requesters are capped in length, and the ticket text reaches the agent as
                  untrusted input.
                </p>
                <pre className="code-block" aria-label="Example request">{webhookExample}</pre>
                <details>
                  <summary style={{ cursor: "pointer", fontSize: 13 }}>JSON schema for the request body</summary>
                  <pre className="code-block" style={{ marginTop: 8 }}>{JSON.stringify(webhookSchema, null, 2)}</pre>
                </details>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
