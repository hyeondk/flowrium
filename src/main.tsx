import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./ui-motion.css";
import "./shell.css";
import "./design-system.css";
import "./chat-workspace.css";
import "./surface-polish.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
