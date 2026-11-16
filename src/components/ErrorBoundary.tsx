// Last line of defence for the window: an error while drawing the interface
// used to unmount everything and leave a blank window that had to be closed.
// Now the error is shown with a way back, and the collection is untouched
// (it lives in the main process, not in this window).
import { Component, type ErrorInfo, type ReactNode } from "react";
import { translate } from "../i18n";

type State = { error: Error | null };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Interface error", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const language = document.documentElement.lang === "en" ? "en" : "es",
      t = (text: string) => translate(text, language);
    return (
      <div className="app-crash" role="alert" data-testid="app-crash">
        <div className="app-crash-card">
          <h1>{t("Algo ha fallado al dibujar la ventana")}</h1>
          <p>
            {t(
              "Tus bases de datos y tus imágenes no se han modificado. Puedes volver a intentarlo o recargar la ventana.",
            )}
          </p>
          <pre>{error.message}</pre>
          <div className="app-crash-actions">
            <button type="button" className="button" onClick={() => this.setState({ error: null })}>
              {t("Volver a intentarlo")}
            </button>
            <button type="button" className="button primary" onClick={() => window.location.reload()}>
              {t("Recargar la ventana")}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
