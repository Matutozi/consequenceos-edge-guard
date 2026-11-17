import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import ActionInspector from "./ActionInspector";
import OpsConsole from "./ops/OpsConsole";

type View = "console" | "inspector";

const viewFromHash = (): View => (window.location.hash === "#/inspector" ? "inspector" : "console");

export default function App() {
  const [view, setView] = useState<View>(viewFromHash);

  useEffect(() => {
    const onHashChange = () => {
      setView(viewFromHash());
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
        </nav>
      </header>

      {view === "console" ? <OpsConsole /> : <ActionInspector />}

      <footer>
        <span>ConsequenceOS Edge Guard</span>
        <span>No receipt, no action.</span>
      </footer>
    </div>
  );
}
