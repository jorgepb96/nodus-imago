// Importing from a IIIF manifest or collection: its metadata become
// properties and its images are downloaded into the collection.
import { useState } from "react";
import type { StandardImport } from "../../shared/imago";
import { useT } from "../i18n";
import { Button, Modal } from "./ui";

export function IiifDialog({ onClose, onImported }: { onClose: () => void; onImported: (result: StandardImport) => void }) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [perCanvas, setPerCanvas] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={t("Importar desde un manifiesto IIIF")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          void window.imago
            .call("iiifImport", { url: url.trim(), perCanvas })
            .then(onImported)
            .catch((err) => setError(err instanceof Error ? err.message : String(err)))
            .finally(() => setBusy(false));
        }}
      >
        <div className="modal-body iiif-dialog">
          <p className="hint">
            {t("Pega el enlace del manifiesto (o de una colección) que ofrece la biblioteca o el archivo digital. Se crea una base de datos con sus metadatos y se descargan las imágenes en tamaño de hasta 2400 píxeles.")}
          </p>
          <label>
            {t("Enlace del manifiesto")}
            <input
              autoFocus
              type="url"
              required
              placeholder="https://…/manifest.json"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              data-testid="iiif-url"
            />
          </label>
          <fieldset className="analysis-task">
            <legend>{t("Registros")}</legend>
            <label className="check-label">
              <input type="radio" checked={perCanvas} onChange={() => setPerCanvas(true)} />
              {t("Un registro por imagen (por ejemplo, las fotografías de un álbum)")}
            </label>
            <label className="check-label">
              <input type="radio" checked={!perCanvas} onChange={() => setPerCanvas(false)} />
              {t("Un registro por objeto, con todas sus imágenes")}
            </label>
          </fieldset>
          {error && <p className="error">{t(error)}</p>}
        </div>
        <footer>
          <Button type="button" onClick={onClose}>
            {t("Cancelar")}
          </Button>
          <Button primary disabled={busy || !url.trim().startsWith("https://")} data-testid="iiif-import">
            {t(busy ? "Importando…" : "Importar")}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
