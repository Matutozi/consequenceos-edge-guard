import { useEffect, useState } from "react";
import { Moon, ShieldCheck, Sun } from "lucide-react";
import ActionInspector from "./ActionInspector";
import ConsoleView from "./ui/console/ConsoleView";
import { applyTheme, storedTheme, type Theme } from "./ui/theme";
import IntegrationsPage from "./ui/integrations/IntegrationsPage";
import EvalsPage from "./ui/evals/EvalsPage";
import LandingPage from "./ui/landing/LandingPage";
import PolicyPage from "./ui/policy/PolicyPage";
import VerifyPage from "./verify/VerifyPage";

type Route =
  | { view: "landing" }
  | { view: "console" }
  | { view: "inspector" }
  | { view: "evals" }
  | { view: "policy" }
  | { view: "verify"; receiptId?: string }
  | { view: "integrations"; sourceId?: string };

function routeFromHash(): Route {
  const hash = window.location.hash;
  if (hash === "#/console") return { view: "console" };
  if (hash === "#/inspector") return { view: "inspector" };
  if (hash === "#/evals") return { view: "evals" };
  if (hash === "#/policy") return { view: "policy" };
  const verify = /^#\/verify(?:\/([^/]+))?$/.exec(hash);
  if (verify) return { view: "verify", receiptId: verify[1] && decodeURIComponent(verify[1]) };
  const integrations = /^#\/integrations(?:\/([^/]+))?$/.exec(hash);
  if (integrations) return { view: "integrations", sourceId: integrations[1] && decodeURIComponent(integrations[1]) };
  return { view: "landing" };
}

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [theme, setTheme] = useState<Theme>(storedTheme);

  useEffect(() => {
    const onHashChange = () => {
      setRoute(routeFromHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => applyTheme(theme), [theme]);

  // Single action (#/inspector) and Integrations (#/integrations) still work at their
  // addresses; the console links to Integrations. The bar keeps to the four that tell the story.
  const nav: [Route["view"], string, string][] = [
    ["console", "#/console", "Console"],
    ["verify", "#/verify", "Verify"],
    ["policy", "#/policy", "Policy"],
    ["evals", "#/evals", "Evals"],
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden="true"><ShieldCheck size={13} /></span>
          <span>Edge Guard</span>
        </a>
        <nav className="nav" aria-label="Views">
          {nav.map(([view, href, label]) => (
            <a key={view} href={href} aria-current={route.view === view ? "page" : undefined}>{label}</a>
          ))}
        </nav>
        <div className="topbar-end">
          <a className="quiet" href="https://github.com/Matutozi/Consequence-OS" target="_blank" rel="noopener noreferrer">
            Built on the ConsequenceOS design
          </a>
          <button
            type="button"
            className="btn btn-ghost icon-btn"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
            title={theme === "dark" ? "Use light theme" : "Use dark theme"}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      <div className="app-main">
        {route.view === "landing" ? (
          <LandingPage />
        ) : route.view === "console" ? (
          <ConsoleView />
        ) : route.view === "verify" ? (
          <VerifyPage receiptId={route.receiptId} />
        ) : route.view === "integrations" ? (
          <IntegrationsPage sourceId={route.sourceId} />
        ) : route.view === "evals" ? (
          <EvalsPage />
        ) : route.view === "policy" ? (
          <PolicyPage />
        ) : (
          <ActionInspector />
        )}
      </div>

    </div>
  );
}
