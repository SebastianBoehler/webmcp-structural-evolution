import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import "./app/tokens.css";
import "./app/app.css";
import "./app/workbench.css";
import "./app/workbench-panels.css";
import "./app/workbench-responsive.css";
import "./app/receipt-ledger.css";
import "./app/component-import.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("The application root is missing.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
