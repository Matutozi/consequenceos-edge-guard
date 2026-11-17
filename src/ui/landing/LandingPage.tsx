const pieces: [string, string][] = [
  [
    "Firebase AI Logic, hybrid inference",
    "Edge Guard asks Gemini Nano on the device first and uses Gemini in the cloud only for public or internal data. The agent's planner runs in the cloud with function calling.",
  ],
  [
    "Firebase Remote Config",
    "Holds the tool registry: each tool's data class, whether it can be undone, and where it may send data. Policy changes without a new deploy.",
  ],
  [
    "Cloud Firestore",
    "Keeps an append-only audit log of signed receipts. Any receipt can be verified from the log alone.",
  ],
  [
    "Firebase App Check",
    "Only this app can call Firebase AI Logic or write to the audit log.",
  ],
];

export default function LandingPage() {
  return (
    <div className="page landing">
      <section className="landing-hero">
        <h1>The brain in the cloud, the conscience on the device.</h1>
        <p>
          An AI agent works support and security tickets for a fictional company, and every tool call it
          proposes goes through Edge Guard before anything runs. Edge Guard decides on the device where it
          can, asks a person when it should, and the executor refuses any call without a signed receipt
          for that exact call.
        </p>
        <div className="presets">
          <a className="btn btn-primary" href="#/console">Open the console</a>
          <a className="btn" href="#/verify">Verify a receipt</a>
        </div>
      </section>

      <section className="landing-built" aria-labelledby="built-heading">
        <h2 id="built-heading">How it is built</h2>
        <dl>
          {pieces.map(([name, line]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{line}</dd>
            </div>
          ))}
        </dl>
        <p className="quiet">
          Edge Guard follows the design of{" "}
          <a href="https://github.com/Matutozi/Consequence-OS" target="_blank" rel="noopener noreferrer">ConsequenceOS</a>,
          an open-source execution gateway for AI agents. Best in Chrome with Gemini Nano; other browsers use the
          cloud for public and internal checks and send sensitive ones to a person.
        </p>
      </section>
    </div>
  );
}
