import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource-variable/google-sans/opsz.css";
import "@fontsource/instrument-sans/latin-400.css";
import "@fontsource/instrument-sans/latin-500.css";
import "@fontsource/instrument-sans/latin-600.css";
import "@fontsource/instrument-sans/latin-700.css";
import "katex/dist/katex.min.css";
import { App } from "./App";
import "./styles/foundation.css";
import "./styles/themes.css";
import "./styles/components.css";
import "./styles/navigation.css";
import "./styles/projects.css";
import "./styles/project-master.css";
import "./styles/secondary.css";
import "./styles/conversation.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
