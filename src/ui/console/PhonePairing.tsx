import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { approvalStore, formatFingerprint, setTrusted, trustedApprovers, type ApproverDoc } from "../../ops/approvals";

type Listed = ApproverDoc & { keyId: string; registeredAt?: string };

/**
 * Pairs Mei Lin's phone with this browser. Anyone can register a key in Firestore, so a
 * phone is trusted only after the person here compares its fingerprint with the one the
 * phone shows. Trust is kept in this browser.
 */
export function PhonePairing({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [trusted, setTrustedState] = useState<string[]>(trustedApprovers);
  const [phones, setPhones] = useState<Listed[]>();
  const [error, setError] = useState("");

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setError("");
      approvalStore.listApprovers().then(setPhones, (caught: unknown) => {
        setPhones([]);
        setError(caught instanceof Error ? caught.message : "Could not read the registered phones.");
      });
    }
  }

  function trust(keyId: string, value: boolean) {
    setTrustedState(setTrusted(keyId, value));
  }

  return (
    <div className="pairing">
      <p className="quiet">
        Approver phone:{" "}
        {trusted.length ? `paired, ${trusted.map(formatFingerprint).join(", ")}` : "none paired, approvals happen here"}{" "}
        <button type="button" className="btn btn-ghost btn-sm" onClick={toggle} disabled={disabled} aria-expanded={open}>
          {open ? "Close" : trusted.length ? "Manage" : "Pair a phone"}
        </button>
      </p>
      {open && (
        <div className="pairing-panel">
          <p className="quiet">
            Open Edge Guard Approver on the phone and compare its fingerprint with the list. Trust only a phone whose
            fingerprint matches. Changes apply to the next run.
          </p>
          {error && <p className="text-deny">{error}</p>}
          {!phones ? (
            <p className="quiet"><LoaderCircle className="spin" size={13} aria-hidden="true" /> Loading registered phones</p>
          ) : phones.length === 0 ? (
            <p className="quiet">No phone has registered yet.</p>
          ) : (
            <ul>
              {phones.map((p) => (
                <li key={p.keyId}>
                  <span>
                    <span className="mono">{formatFingerprint(p.keyId)}</span>
                    <span className="quiet"> {p.name}, {p.platform}{p.registeredAt ? `, ${new Date(p.registeredAt).toLocaleString()}` : ""}</span>
                  </span>
                  <button type="button" className="btn btn-sm" onClick={() => trust(p.keyId, !trusted.includes(p.keyId))}>
                    {trusted.includes(p.keyId) ? "Stop trusting" : "Trust"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
