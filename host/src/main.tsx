import { createRoot } from "react-dom/client";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import { ThemeProvider } from "./theme";
import { App } from "./App";
import "./App.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}
