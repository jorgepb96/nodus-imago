# Privacidad

Nodus Imago no tiene cuentas, publicidad, analítica ni telemetría.

- **Modo inicial local:** datos SQLite, originales, miniaturas, metadatos, consultas, índices y modelos residen en el equipo. No se consulta una API al iniciar la aplicación.
- **Descargas explícitas:** solo la acción Descargar solicita activos de los repositorios oficiales fijados en `shared/modelCatalog.json` y `shared/runtimeCatalog.json`. Se verifican tamaños, hashes y revisiones. Pausar o cancelar interrumpe la conexión.
- **Inferencia local:** los procesos Python y llama.cpp reciben archivos locales. Python desactiva acceso de red y código remoto. El motor nativo no abre un servidor. Los modelos se descargan aparte.
- **APIs voluntarias:** la actualización del encargo del 29 de octubre de 2026 permite APIs. Están desactivadas por defecto. Al habilitarlas y encolar una tarea con un proveedor remoto, se envían imágenes redimensionadas (hasta dos por celda), instrucciones y contexto de las propiedades de esa fila al endpoint elegido. No hay fallback automático. Los embeddings y las consultas de búsqueda no se envían.
- **Credenciales:** almacenamiento cifrado del sistema operativo, fuera de SQLite y las copias. La interfaz no recibe secretos almacenados. No se accede al perfil ni al llavero de Nodus. En Linux se rechaza `basic_text`. No se registran cabeceras ni respuestas de error que puedan incluir claves.
- **Exportaciones:** contienen los datos que el usuario elige exportar. Una copia completa incluye todos los originales vinculados disponibles, incluso si proceden de ubicaciones externas. La restauración conserva IDs y pausa trabajos importados para revisión; no importa credenciales ni sustituye ajustes del dispositivo.
- **Renderer:** sin Node.js, preload reducido, sandbox, aislamiento de contexto, validación IPC y navegación externa bloqueada. No puede solicitar rutas arbitrarias mediante la API pública. Los archivos se seleccionan con diálogos nativos o arrastrando archivos reales.

Las pruebas automatizadas de APIs usan conexiones inyectadas de prueba. No se ha enviado material ni credenciales reales del usuario a ningún proveedor. Los pesos de EmbeddingGemma 2, LFM3-VL-2B y el motor llama.cpp se descargaron con autorización expresa y se validaron con archivos locales; no se envían a ningún servicio durante la inferencia. El entorno Python y los pesos no se incluyen en el instalador.
