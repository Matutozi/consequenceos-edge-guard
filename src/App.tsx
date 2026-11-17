import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import ActionInspector from "./ActionInspector";
import OpsConsole from "./ops/OpsConsole";
import VerifyPage from "./verify/VerifyPage";

type Route = { view: "console" } | { view: "inspector" } | { view: "verify"; receiptId?: string };

function routeFromHash(): Route {
  const hash = window.location.hash;
  if (hash === "#/inspector") return { view: "inspector" };
  const verify = /^#\/verify(?:\/([^/]+))?$/.exec(hash);
  if (verify) return { view: "verify", receiptId: verify[1] && decodeURIComponent(verify[1]) };
  return { view: "console" };
}

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const { view } = route;

  useEffect(() => {
    const onHashChange = () => {
      setRoute(routeFromHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#/console" aria-label="ConsequenceOS Edge Guard home">
          <span className="brand-mark"><ShieldCheck size={19} /></span>
          <span>Consequence<span>OS</span></span>
          <span className="product-tag">EDGE GUARD</span>
        </a>
        <nav className="view-tabs" aria-label="Views">
          <a href="#/console" aria-current={view === "console" ? "page" : undefined}>Agent console</a>
          <a href="#/inspector" aria-current={view === "inspector" ? "page" : undefined}>Single action</a>
          <a href="#/verify" aria-current={view === "verify" ? "page" : undefined}>Verify</a>
        </nav>
      </header>

      {route.view === "console" ? (
        <OpsConsole />
      ) : route.view === "verify" ? (
        <VerifyPage receiptId={route.receiptId} />
      ) : (
        <ActionInspector />
      )}

      <footer>
        <span>ConsequenceOS Edge Guard</span>
        <span>No receipt, no action.</span>
      </footer>
    </div>
  );
}
