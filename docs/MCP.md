# Servidor MCP de Nodus Imago

Imago puede abrir un servidor [Model Context Protocol](https://modelcontextprotocol.io) local para que un asistente de IA (Claude Desktop, Claude Code, Cursor, ChatGPT mediante un túnel…) consulte y, si el usuario lo permite, modifique sus bases de datos.

## Origen: cómo lo hace Nodus Research

El diseño sigue el de Nodus (`electron/mcp/server.ts`, `tools.ts`, `McpConnectionModal.tsx`):

- **Transporte** Streamable HTTP del SDK oficial (`@modelcontextprotocol/sdk` 1.29.0), escuchando solo en `127.0.0.1`.
- **Autenticación** con un token bearer aleatorio de 32 bytes, comparado en tiempo constante.
- **Protección DNS-rebinding**: se rechaza cualquier `Host` que no sea `127.0.0.1`/`localhost` con el puerto y cualquier `Origin` de navegador ajeno.
- **Sesiones** en memoria, una por cliente; una sesión desconocida responde 404 para que el cliente se reinicialice solo; las inactivas más de 30 min se cierran.
- **Herramientas** con anotaciones `readOnlyHint`/`destructiveHint` y errores legibles para el modelo.
- **Ajustes**: activar/desactivar, puerto, token visible y regenerable, instrucciones por cliente.

Diferencias deliberadas en Imago:

| | Nodus | Imago |
|---|---|---|
| Permisos | Escritura limitada, siempre activa con el servidor | **Solo lectura por defecto**; escritura completa solo tras un modal de confirmación |
| Dónde viven ajustes y token | Base de datos de la bóveda | `userData/mcp.json` (0600), fuera de la colección: las copias de seguridad nunca llevan el token |
| Puerto ocupado | Cae a un puerto aleatorio | Informa del error (el cliente tiene la URL fija) |
| Túnel de ChatGPT | Cliente oficial de OpenAI integrado | Igual, y además instala `cloudflared` y su manifiesto (incluidos en el paquete desde tunnel-client 0.0.21) y desactiva el descubrimiento OAuth (`MCP_OAUTH_DISCOVERY=disabled`) |
| Puerto por defecto | 4319 | 4329 (pueden convivir) |

## Arquitectura

```
Cliente MCP ──HTTP 127.0.0.1:4329/mcp──▶ McpHost (proceso principal)
                                           │  registerImagoTools(ctx)
                                           ▼
                                  ctx.call(comando, entrada)
                                           │  validateCommand (mismos esquemas que la ventana)
                                           ▼
                                  Worker → Service.run → Repository (historial, reglas)
```

- `shared/mcp.ts` — tipos (`McpConfig`, `McpStatus`), valores por defecto y la conversión pura entre celdas de Imago y valores legibles (`mcpCellValue`, `mcpEncodeValue`, `mcpFilterValue`, `mcpMissingOptions`).
- `electron/mcp/tools.ts` — el catálogo de herramientas. No conoce Electron: recibe `call`, `access`, `changed` y `calc`, así que los tests lo usan con un `Service` real.
- `electron/mcp/server.ts` — `McpHost`: ciclo de vida serializado, ajustes, token, sesiones, actividad.
- `electron/main.ts` — crea el host, enruta `mcpStatus`, `mcpConfigure` y `mcpRegenerateToken` desde la ventana (solo desde el marco principal de confianza) y avisa a la ventana con `imago:changed` (`data` tras una escritura, `mcp` para el panel).
- `electron/service.ts` — `_mcpImage` (la imagen tal como se muestra, en JPEG) y `_mcpImageOwner`; los comandos con `_` nunca son accesibles desde la ventana.
- `src/components/McpSettings.tsx` — Ajustes → Servidor MCP.

Cada herramienta de escritura usa los mismos comandos que la interfaz, de modo que respeta sus reglas (opciones válidas, relaciones compatibles, tipos calculados de solo lectura…) y su historial: `imago_undo` o el botón Deshacer revierten los cambios en celdas, registros y opciones.

## Permisos

1. **Apagado** (por defecto): no hay ningún puerto abierto.
2. **Solo lectura** (por defecto al activarlo): solo se registran herramientas de lectura.
3. **Lectura y escritura**: el usuario elige la opción y confirma en un modal que enumera lo que el cliente podrá hacer y qué no se puede deshacer; el botón queda desactivado hasta marcar «Entiendo los riesgos».

Defensa en profundidad: las herramientas de escritura solo se registran cuando la sesión nace con escritura, y cada una vuelve a comprobar el permiso al ejecutarse. Cambiar el permiso o regenerar el token cierra todas las sesiones, y los clientes vuelven a pedir la lista de herramientas. El cliente MCP no tiene ninguna herramienta para cambiar ajustes, permisos, claves de API ni modelos.

## Herramientas

Lectura (siempre):

| Herramienta | Qué hace |
|---|---|
| `imago_get_overview` | Versión, tamaño de la colección, cobertura del índice, permiso actual, tipos de propiedad y formato de valores |
| `imago_list_databases` | Todas las bases con id, id corto, tipo, registros y propiedades |
| `imago_get_database` | Propiedades: tipo, opciones, configuración, si se pueden escribir y operadores de filtro |
| `imago_query_records` | Registros con todas sus celdas como valores legibles; filtros, orden, búsqueda literal/semántica/híbrida, selección de propiedades, paginación |
| `imago_get_record` | Un registro completo: propiedades, imágenes, anotaciones y registros vinculados |
| `imago_search` | Búsqueda entre bases (literal, semántica con embeddings de texto e imagen, híbrida) con aviso cuando no hay nada indexado |
| `imago_find_similar_images` | Registros con imágenes parecidas, o un detalle (región) dentro de otras imágenes |
| `imago_get_image` | Las fotos (por imagen o por registro) como contenido de imagen para que el modelo las analice |
| `imago_summarize_property` | Suma, media, mediana, mínimo, máximo, únicos, vacíos, fechas… sobre los registros filtrados |
| `imago_compute_statistic` | Frecuencias, tablas cruzadas (recuentos, porcentajes, residuos), coocurrencias, tendencias y distribuciones |
| `imago_count_values` | Todos los valores distintos de una propiedad con su recuento |
| `imago_timeline` | Registros por año |
| `imago_run_calculation` | JavaScript arbitrario sobre todos los registros en el proceso aislado del chat (sin ficheros, red ni módulos; 15 s) |
| `imago_list_saved` | Vistas y estadísticas guardadas |
| `imago_list_jobs` | Cola de tareas |

Escritura (solo con permiso):

| Herramienta | Qué hace |
|---|---|
| `imago_create_database`, `imago_update_database`, `imago_delete_database` | Crear (con plantilla), renombrar/icono/tipo, eliminar (exige repetir el nombre) |
| `imago_add_property` | Propiedad de cualquier tipo, con opciones, relación (bidireccional), rollup o configuración libre |
| `imago_update_property` | Renombrar, configurar, añadir/renombrar/quitar opciones |
| `imago_convert_property`, `imago_delete_property`, `imago_reorder_properties` | Cambiar tipo (con vista previa), eliminar, reordenar |
| `imago_create_records`, `imago_update_records`, `imago_delete_records` | Registros con valores por nombre de propiedad; crea las opciones que falten |
| `imago_import_images` | Importa ficheros o carpetas de imágenes como tarea en segundo plano |
| `imago_annotate_image`, `imago_delete_annotation` | Regiones con nota y etiquetas |
| `imago_set_link_details` | Página, figura o lámina, pie de foto y nota de un vínculo entre dos registros (una foto en la página 12 de un libro) |
| `imago_run_ai_properties` | Encola la IA de Imago para rellenar propiedades de IA |
| `imago_undo`, `imago_redo` | Deshacer y rehacer |

### Valores

Lectura y escritura usan el mismo formato: etiquetas de opción (no ids), números, booleanos, fechas `AAAA-MM-DD` o `{start,end,includeTime}`, fechas históricas como texto («c. 1930», «s. XIX») o `{text,start,end,certainty}`, personas como nombres, ubicaciones como `{name,address,latitude,longitude}`, relaciones como ids de registro (al escribir también títulos exactos; `imago_get_record` añade el título de cada registro enlazado y lo que guarda su vínculo) e imágenes como `{imageId,fileName}`. Bases y propiedades se nombran por id o por nombre exacto.

## ChatGPT: túnel seguro de OpenAI

ChatGPT no puede llegar a `127.0.0.1`, y el servidor no se publica en Internet. Como en Nodus, Imago usa el **Secure MCP Tunnel** de OpenAI (`electron/mcp/tunnel.ts`, `shared/mcpTunnel.ts`, `src/components/McpTunnelPanel.tsx`):

1. El usuario crea un túnel en platform.openai.com (ID `tunnel_` + 32 hex) y una clave de ejecución con permisos *Tunnels Read + Use*, y las pega en Ajustes → Servidor MCP → ChatGPT.
2. Imago guarda la clave en el almacén cifrado del sistema (`secrets/`, nunca sin cifrar ni en copias de seguridad) y el ID en `userData/mcp-tunnel/config.json` (0600).
3. Pide la última publicación de `github.com/openai/tunnel-client`, elige el zip de la plataforma, comprueba que viene de esa publicación, su tamaño y su SHA-256 (del `digest` de GitHub o de `SHA256SUMS.txt`) y solo entonces instala los archivos de la raíz del zip en `mcp-tunnel/runtime/<versión>/`.
4. Ejecuta `tunnel-client doctor` y luego `tunnel-client run`, con todas las credenciales en variables de entorno (nunca en la línea de órdenes): la clave, el ID, la URL real del servidor local y la cabecera `Authorization: Bearer <token>`. El cliente solo abre conexiones salientes hacia OpenAI.
5. Espera a `/readyz` en su puerto de salud local y muestra los pasos para añadir Imago como complemento en ChatGPT (Túnel, sin autenticación).

El túnel sigue al servidor: se apaga con él, se reinicia al cambiar el puerto o el token, vuelve a conectarse al abrir Imago si el usuario no lo desconectó, y «Borrar conexión guardada» elimina ID y clave. ChatGPT tiene **los mismos permisos** elegidos para el servidor (solo lectura por defecto). Los errores se clasifican (clave rechazada, permisos, túnel inexistente, red, integridad…) y su detalle técnico se muestra sin claves ni tokens.

## Conectar un cliente

- **Claude Desktop**: el panel genera la entrada de `claude_desktop_config.json` con el puente `mcp-remote`.
- **Claude Code**: `claude mcp add --transport http nodus-imago http://127.0.0.1:4329/mcp --header "Authorization: Bearer <token>"`.
- **ChatGPT**: pestaña ChatGPT, mediante el túnel seguro de OpenAI (arriba).
- **Otros**: Streamable HTTP con la URL y la cabecera `Authorization: Bearer <token>`.

## Pruebas

- `tests/mcp.test.ts` — conversión de valores; servidor real en un puerto libre con un cliente MCP real del SDK sobre una colección temporal: autenticación, Host/Origin, permisos, lista de herramientas por permiso, todas las herramientas de lectura y escritura, imágenes, estadísticas, cálculo aislado, deshacer y cierre de sesiones al cambiar permisos.
- `tests/mcpTunnel.test.ts` — validación de IDs, nombres de paquete, clasificación de errores y diagnósticos sin secretos; y el ciclo completo contra un GitHub simulado con un `tunnel-client` falso que llama de verdad al servidor MCP con el token recibido: descarga y verificación, `doctor`, `run`, credenciales fuera de argv y del estado, reinicio con un token nuevo, caída del cliente, desconexión, apagado del servidor, olvido, clave rechazada, descarga manipulada, URL no oficial, sin red y sistema no soportado.
- `scripts/mcp-e2e.mjs` — la aplicación empaquetada con un `userData` temporal: activar el servidor, conceder escritura con el modal, y un cliente MCP que lee y escribe mientras la ventana refleja los cambios.
