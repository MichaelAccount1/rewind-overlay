import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/global.css";

document.documentElement.classList.toggle(
  "overlay-document",
  window.location.pathname.startsWith("/overlay")
);

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>
);
