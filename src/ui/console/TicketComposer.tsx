import { useState, type FormEvent } from "react";
import { createManualTicket, ticketTemplates, type ManualDraft } from "../../intake/adapters/manual";
import type { Priority, Ticket } from "../../intake";

const empty: ManualDraft = { title: "", requester: "", priority: "normal", body: "" };

/** Writes a ticket into the Manual source. The agent can then be run on it like any other. */
export function TicketComposer({ onCreated, onCancel }: { onCreated: (ticket: Ticket) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<ManualDraft>(ticketTemplates[0].draft);
  const [error, setError] = useState("");

  function set<K extends keyof ManualDraft>(key: K, value: ManualDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setError("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      onCreated(createManualTicket(draft));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The ticket could not be created.");
    }
  }

  return (
    <form className="composer" onSubmit={submit} aria-label="New ticket">
      <div className="composer-head">
        <h1>New ticket</h1>
        <p className="quiet">
          Write a ticket as Northwind staff would, or start from a template. It stays in this browser.
        </p>
        <div className="presets" aria-label="Templates">
          {ticketTemplates.map((t) => (
            <button key={t.name} type="button" className="btn btn-sm" onClick={() => { setDraft(t.draft); setError(""); }}>
              {t.name}
            </button>
          ))}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setDraft(empty); setError(""); }}>
            Blank
          </button>
        </div>
      </div>
      <label className="field">
        Title
        <input required maxLength={200} value={draft.title} onChange={(e) => set("title", e.target.value)} />
      </label>
      <div className="form-grid">
        <label className="field">
          Requester
          <input required maxLength={200} value={draft.requester} onChange={(e) => set("requester", e.target.value)} />
        </label>
        <label className="field">
          Priority
          <select value={draft.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
      </div>
      <label className="field">
        Description
        <textarea required rows={7} maxLength={8000} value={draft.body} onChange={(e) => set("body", e.target.value)} />
      </label>
      <p className="quiet">
        The directory has three people the agent can act on: ada.okafor, tomas.reyes and mei.lin. Anything
        you write here reaches the agent as untrusted text, the same as a real ticket.
      </p>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <div className="presets">
        <button type="submit" className="btn btn-primary">Create ticket</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
