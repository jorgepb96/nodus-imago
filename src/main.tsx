import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./theme/apply";
import "./index.css";
import { installTooltips } from "./tooltips";
installTooltips();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
