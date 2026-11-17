import { describe, expect, it } from "vitest";
import { fromEmail } from "./adapters/email";
import { adfToText, fromJira } from "./adapters/jira";
import { createManualTicket, fromManual, ticketTemplates } from "./adapters/manual";
import { sampleTickets } from "./adapters/sample";
import { fromServiceNow } from "./adapters/servicenow";
import { fromWebhook } from "./adapters/webhook";
import { fromZendesk } from "./adapters/zendesk";
import { InvalidTicketError, LIMITS, ticketSources } from "./index";

describe("webhook", () => {
  it("normalizes a valid payload", () => {
    const t = fromWebhook({ title: " Locked out ", body: "Help", requester: "tomas.reyes@northwind.example", priority: "high", externalRef: "CRM-1" });
    expect(t).toMatchObject({ source: "webhook", title: "Locked out", priority: "high", externalRef: "CRM-1" });
    expect(t.raw).toBeDefined();
  });

  it("defaults priority and reference, and rejects missing fields", () => {
    const t = fromWebhook({ title: "t", body: "b", requester: "r", priority: "panic" });
    expect(t.priority).toBe("normal");
    expect(t.externalRef).toBe("none");
    expect(() => fromWebhook({ title: "t", requester: "r" })).toThrow(InvalidTicketError);
  });

  it("caps oversized text from untrusted input", () => {
    const t = fromWebhook({ title: "t", body: "x".repeat(LIMITS.body + 500), requester: "r" });
    expect(t.body).toHaveLength(LIMITS.body);
  });
});

describe("jira", () => {
  const payload = {
    issue: {
      key: "ITSM-42",
      fields: {
        summary: "VPN down",
        description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Since 9am." }] }] },
        reporter: { emailAddress: "ada.okafor@northwind.example" },
        priority: { name: "Highest" },
        created: "2026-11-17T09:00:00.000+0000",
        attachment: [{ filename: "trace.log", content: "https://example.atlassian.net/a/1" }],
      },
    },
  };

  it("maps an issue-created payload", () => {
    expect(fromJira(payload)).toMatchObject({
      source: "jira",
      externalRef: "ITSM-42",
      title: "VPN down",
      body: "Since 9am.",
      requester: "ada.okafor@northwind.example",
      priority: "urgent",
      attachments: [{ name: "trace.log" }],
    });
  });

  it("reduces Atlassian Document Format to text", () => {
    expect(adfToText("plain")).toBe("plain");
    expect(adfToText({ type: "doc", content: [{ type: "heading", content: [{ type: "text", text: "A" }] }] })).toBe("A\n");
  });

  it("rejects an issue without a summary", () => {
    expect(() => fromJira({ issue: { key: "X-1", fields: { description: "d", reporter: { displayName: "x" } } } })).toThrow(/summary/);
  });
});

describe("zendesk", () => {
  it("maps a ticket payload", () => {
    const t = fromZendesk({ ticket: { id: 99, subject: "Refund", description: "Please refund", requester: { name: "Customer" }, priority: null, created_at: "2026-11-17T10:00:00Z" } });
    expect(t).toMatchObject({ source: "zendesk", externalRef: "99", requester: "Customer", priority: "normal" });
  });
});

describe("servicenow", () => {
  it("maps an incident, including the numeric priority and UTC date", () => {
    const t = fromServiceNow({
      result: { number: "INC0010001", short_description: "Email down", description: "", caller_id: { display_value: "Mei Lin" }, priority: "1 - Critical", sys_created_on: "2026-11-17 14:03:00" },
    });
    expect(t).toMatchObject({ externalRef: "INC0010001", title: "Email down", body: "Email down", requester: "Mei Lin", priority: "urgent", createdAt: "2026-11-17T14:03:00.000Z" });
  });

  it("treats priorities 4 and 5 as low", () => {
    const base = { number: "INC1", short_description: "x", caller_id: "y" };
    expect(fromServiceNow({ ...base, priority: "5 - Planning" }).priority).toBe("low");
  });
});

describe("email", () => {
  it("takes the address from the From header and reads priority headers", () => {
    const t = fromEmail({ messageId: "<m1@mail>", from: "Ada Okafor <ada.okafor@northwind.example>", subject: "Help", text: "Body", headers: { Importance: "High" } });
    expect(t).toMatchObject({ requester: "ada.okafor@northwind.example", priority: "high", externalRef: "<m1@mail>" });
    expect(fromEmail({ messageId: "m2", from: "x@y.z", subject: "s", text: "t", headers: { "X-Priority": "5 (Lowest)" } }).priority).toBe("low");
  });
});

describe("manual", () => {
  it("normalizes every template", () => {
    for (const { draft } of ticketTemplates) expect(fromManual(draft).source).toBe("manual");
  });

  it("numbers manual tickets from 1001 without colliding with sample tickets", () => {
    const a = createManualTicket(ticketTemplates[0].draft);
    const b = createManualTicket(ticketTemplates[2].draft);
    expect(a.number).toBeGreaterThanOrEqual(1001);
    expect(b.number).toBe(a.number + 1);
    expect(b.id).toBe(`manual:${b.number}`);
    expect(sampleTickets.map((t) => t.number)).not.toContain(a.number);
  });

  it("rejects a draft with no description", () => {
    expect(() => fromManual({ ...ticketTemplates[0].draft, body: "  " })).toThrow(/description/);
  });
});

describe("sources", () => {
  it("are honest: only manual and sample are available, and planned ones document their mapping and auth", () => {
    const available = ticketSources.filter((s) => s.status === "available").map((s) => s.id);
    expect(available).toEqual(["manual", "sample"]);
    for (const s of ticketSources.filter((s) => s.status === "planned")) {
      expect(s.mapping?.length).toBeGreaterThan(0);
      expect(s.auth).toBeTruthy();
      expect(s.listTickets).toBeUndefined();
    }
  });
});
