# Publicar un aviso

Los avisos son el único canal que llega a las copias instaladas de Imago entre versiones:
una encuesta que merece respuesta, un proveedor que dejó de funcionar, una advertencia
sobre una versión concreta. Aparecen en la campana de la cabecera y siguen sin leer hasta
que se abren uno a uno. El sistema está adaptado del de Nodus.

Añadir un aviso es un pull request. Fusionarlo en `main` es publicarlo.

## Dónde está

| | |
| --- | --- |
| Fuente | [`announcements/announcements.json`](../announcements/announcements.json) |
| Publicado en | `https://raw.githubusercontent.com/jorgepb96/nodus-imago/main/announcements/announcements.json` |
| Validado por | [`shared/announcements.ts`](../shared/announcements.ts) (lo que no cumple, se descarta) |
| Leído por | [`electron/announcements.ts`](../electron/announcements.ts) |

## Cómo añadir uno

Añade un objeto a `notices`. El orden en el archivo da igual: la aplicación los ordena por
fecha, del más reciente al más antiguo, y una advertencia va antes que una información del
mismo día.

```jsonc
{
  "id": "2026-12-encuesta-imago",   // slug estable, NUNCA se reutiliza
  "date": "2026-12-01",             // AAAA-MM-DD
  "severity": "info",               // "info" | "warning"
  "url": "https://…",               // opcional, solo https
  "expiresAt": "2027-01-15",        // opcional; el aviso desaparece solo después de ese día
  "minVersion": "0.5.0",            // opcional, inclusive
  "maxVersion": "0.6.0",            // opcional, inclusive
  "copy": {
    "es": { "title": "…", "body": "…", "linkLabel": "Responder la encuesta" },
    "en": { "title": "…", "body": "…", "linkLabel": "Answer the survey" }
  }
}
```

**Español e inglés son obligatorios**: un aviso sin alguno de los dos se descarta.

Límites, que aplica el validador: título 120 caracteres, cuerpo 600, `linkLabel` 60,
URL 300 y como máximo 50 avisos en el archivo.

## Qué hace la aplicación

Una petición `GET` condicional unos segundos después de arrancar y otra cada cuatro horas.
El `ETag` de la respuesta se guarda y se reenvía como `If-None-Match`, así que lo habitual
es un `304` sin cuerpo. La última respuesta válida se guarda en `userData`, de modo que la
campana funciona sin conexión. No se envía ningún identificador ni dato de la colección.

Se puede desactivar en **Ajustes › Actualizaciones y novedades**; entonces no se hace
ninguna petición.

## Reglas

- **No reutilices nunca un `id`.** De él cuelga la marca de leído: reutilizarlo marcaría
  como leído un aviso nuevo para quien leyó el anterior.
- **No cambies el sentido de un aviso publicado.** Publica uno nuevo.
- **Prefiere `expiresAt` a borrar.** Borrar lo hace desaparecer a mitad de lectura;
  la caducidad lo retira de forma previsible.
- **Los cuerpos son texto plano.** No se interpreta ningún marcado.
- **Los enlaces se abren en el navegador del sistema**, y solo sobreviven los `https:`.

## Probar sin publicar

Apunta la aplicación a cualquier URL, también a un servidor local:

```bash
IMAGO_ANNOUNCEMENTS_URL=http://localhost:8080/announcements.json npm run dev
```

`IMAGO_DISABLE_ANNOUNCEMENTS=1` desactiva el canal por completo.
