# Auditoría visual de modales — 13 de noviembre de 2026

Referencia leída: `TextInputModal.tsx` y `ConfirmModal.tsx` de Nodus Research, con relleno interior de 20 px y acciones separadas del contenido. Imago mantiene su tipografía, colores, bordes y componentes; utiliza un margen base de 24 px en los diálogos estándar.

## Hallazgos y correcciones

- Comprobación y restauración de copias: campos y botones a 1 px del borde; sus contenidos no tenían `.modal-body`. El componente compartido ahora añade su propio contenedor con relleno por defecto. Los botones finales se presentan en un pie separado y alineado.
- Automatizaciones: introducción, errores e historial sin relleno; el historial y el botón de añadir regla podían desbordarse con zoom. Se delimitan las zonas de introducción, navegación, editor e historial.
- Importación de imágenes: una regla de ancho completo para inputs también afectaba a checkboxes y empujaba las etiquetas fuera del diálogo. La regla ahora excluye checkboxes y radios. El desbordamiento horizontal medido pasa de 80 px a cero.
- Pies de acciones: los botones pueden pasar a otra línea y sus etiquetas se ajustan al espacio disponible. Los nombres extensos no expulsan el cierre ni el contenido fuera del diálogo.
- Propiedades y concordancia conservan su composición por paneles mediante una variante explícita. Se mantienen sus zonas acolchadas, evitando duplicar márgenes.

El relleno ya no depende de que cada consumidor recuerde añadir una clase. Los encabezados, formularios, mensajes y pies comparten un criterio de separación. Se mantienen el desplazamiento interno y el encabezado fijo.

## Cobertura

Revisados todos los usos de `Modal`: creación/renombrado, altas y confirmaciones de borrado, búsquedas guardadas, importación CSV/imágenes, tareas, propuestas, propiedades, automatizaciones, concordancia, licencias, copias y mapas ampliados. El panel de registro y el globo de colas conservan sus márgenes propios; los recorridos existentes comprueban el registro y los mapas anidados.

`npm run test:modals:e2e` abre diálogos reales en un perfil aislado y realiza **27 comprobaciones visuales y de geometría**. Incluye nombres largos sin espacios, encabezados extensos, pies con varias acciones, tablas, contenido largo, tema claro/oscuro, inglés y ventana de 1000 × 680 con zoom al 125 %. Comprueba controles separados de los bordes, ausencia de desbordamiento horizontal y encaje del diálogo en el viewport. Captura desde Electron para conservar correctamente el zoom en las imágenes.

Evidencia anterior: `test-results/modal-audit-1794581271434/evidence.json`, aplicación empaquetada `d72e716`, modo de diagnóstico. Evidencia posterior local: `test-results/modal-audit-1794581968332/evidence.json`, sin incidencias ni errores de renderer. En las copias, el margen medido de los controles pasa de 1 px a 25 px contando el borde; en los paneles se conserva un margen compacto mínimo de 16 px.

Pasaron tipos, lint, build y los diez recorridos del driver de escritorio (nueve recorridos de aplicación y el protocolo independiente de actualización). El recorrido de copias también sigue creando y restaurando los archivos correctamente.

La auditoría se incorpora al driver común para ejecutarse tanto sobre fuente como sobre los ejecutables empaquetados de los cinco targets. La CI sube su JSON y sus capturas como evidencia. Los resultados multiplataforma de esta modificación se registrarán por commit y run al terminar; la CI anterior `43424372795` corresponde a la revisión de fiabilidad previa.
