import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import "./styles.css";

const mountNode = document.getElementById("root");
if (!mountNode) {
  throw new Error("NetGuard mount node #root was not found.");
}

createRoot(mountNode).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
