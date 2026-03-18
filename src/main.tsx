import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

interface EBProps {
  children: React.ReactNode;
}

interface EBState {
  error: Error | null;
}

class ErrorBoundary extends React.Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): EBState {
    return { error };
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return React.createElement(
        "div",
        { style: { padding: 40, fontFamily: "monospace", color: "red", background: "white" } },
        React.createElement("h1", null, "Runtime Error"),
        React.createElement(
          "pre",
          { style: { whiteSpace: "pre-wrap", wordBreak: "break-all" } },
          this.state.error.message
        ),
        React.createElement(
          "pre",
          { style: { whiteSpace: "pre-wrap", fontSize: 11, marginTop: 10, color: "#666" } },
          this.state.error.stack
        )
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById("root");
ReactDOM.createRoot(root as HTMLElement).render(
  React.createElement(
    React.StrictMode,
    null,
    React.createElement(ErrorBoundary, null, React.createElement(App))
  )
);
