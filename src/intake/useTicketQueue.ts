import { useCallback, useEffect, useState } from "react";
import { ticketSources, type Ticket } from "./index";

export interface TicketQueue {
  tickets: Ticket[];
  loading: boolean;
  /** Sources that failed to list, with the reason. */
  errors: string[];
  refresh(): void;
}

/** Newest first, so a ticket you just wrote is at the top. */
const byNewest = (a: Ticket, b: Ticket) => b.createdAt.localeCompare(a.createdAt) || b.number - a.number;

/** Tickets from every available source, in one list, kept current as new ones arrive. */
export function useTicketQueue(): TicketQueue {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  const refresh = useCallback(() => {
    const available = ticketSources.filter((s) => s.status === "available" && s.listTickets);
    setLoading(true);
    void Promise.allSettled(available.map((s) => s.listTickets!())).then((results) => {
      const found: Ticket[] = [];
      const failed: string[] = [];
      results.forEach((result, i) => {
        if (result.status === "fulfilled") found.push(...result.value);
        else failed.push(`${available[i].name}: ${result.reason instanceof Error ? result.reason.message : "could not list tickets"}`);
      });
      setTickets(found.sort(byNewest));
      setErrors(failed);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribers = ticketSources
      .filter((s) => s.status === "available" && s.subscribe)
      .map((s) =>
        s.subscribe!((ticket) =>
          setTickets((current) => [ticket, ...current.filter((t) => t.id !== ticket.id)].sort(byNewest)),
        ),
      );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [refresh]);

  return { tickets, loading, errors, refresh };
}
