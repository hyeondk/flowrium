import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installDatePicker } from "../electron/mobile/date-picker.js";
import { installKeyboardFocus } from "../electron/mobile/keyboard-focus.js";
import "../electron/mobile/date-picker.css";
import "./styles.css";
import "./ui-motion.css";
import "./shell.css";
import "./design-system.css";
import "./chat-workspace.css";
import "./surface-polish.css";
import "./workspace-layout.css";
import "./compact-density.css";
import "./composer-layout.css";
import "../electron/mobile/close-button.css";
import "../electron/mobile/keyboard-focus.css";
import nativeSelectPosition from "./native-select-position.css?raw";

installDatePicker();
installKeyboardFocus();
if(CSS.supports('container-type','anchored')){
  // Chromium supports anchored container queries before the CSS minifier does.
  const rules=document.createElement('style');
  rules.textContent=nativeSelectPosition;
  document.head.append(rules);
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
