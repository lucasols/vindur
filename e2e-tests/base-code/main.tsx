import React from "react";
import ReactDOM from "react-dom/client";
// @ts-expect-error - App.tsx will be added by the test
import App from "./App.tsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
