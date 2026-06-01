# Mejoras aplicadas al panel Admin · Calificaciones

Este ZIP conserva la estructura original del proyecto y mejora principalmente `admin.html` y `admin.js`.

## Qué se agregó

- KPIs ampliados: total, promedio, personas evaluadas, porcentaje con comentario, evaluaciones recientes, evaluaciones menores a 5, alertas críticas y última evaluación.
- Filtros nuevos: persona/rol/personId, periodo rápido, rango exacto de fechas, estrellas, comentarios, búsqueda dentro de comentarios, mínimo de evaluaciones y límite de datos cargados.
- Ranking mejorado: foto, nombre, rol fusionado desde `data.json`, promedio, cantidad, comentarios, señales por debajo de 5, última fecha, tendencia y estado.
- Lectura rápida automática: resumen textual de lo que muestran los datos filtrados.
- Control de datos: avisa si hay `personId` que no aparecen en `data.json`, registros sin fecha, sin personId o sin estrellas.
- Gráficas sin librerías externas: distribución de estrellas, actividad por día y participación por área.
- Comentarios en tarjetas: lectura más clara que una tabla gigante.
- Registro crudo plegable: sigue disponible para auditoría, pero ya no se roba toda la pantalla.
- Exportación doble: registros filtrados y ranking agregado.

## Archivos modificados

- `admin.html`
- `admin.js`

## Cómo probar

1. Abrir el proyecto como servidor local, no directamente como archivo.
2. Entrar a `admin.html`.
3. Iniciar sesión con un correo autorizado.
4. Revisar filtros, KPIs, gráficas y exportaciones.

Si se prueba en local, recuerden tener `localhost` o `127.0.0.1` autorizado en Firebase Authentication si el login falla. Porque Firebase, en su infinita vocación de convertir lo simple en trámite, exige eso.
