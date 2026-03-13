# AppFeed

Lector RSS/Atom moderno con persistencia en Puter, resumen con IA y modo PWA.

## Caracteristicas

- Gestion de categorias y feeds con guardado en la nube de Puter.
- Descubrimiento automatico de fuentes RSS/Atom desde una URL web.
- Filtros por texto, ordenamiento y paginacion.
- Resumen de noticias con IA y asistente conversacional para acciones de gestion.
- Modo claro/oscuro, refresco automatico y cache offline basica.
- Importacion/exportacion de configuracion en JSON.

## Stack

- Frontend: HTML + Tailwind CDN + JavaScript vanilla.
- Persistencia y capacidades IA: Puter.js.
- Proxy RSS: PHP.
- PWA: Service Worker + Web App Manifest.

## Estructura

- index.html: interfaz principal.
- main.js: logica de aplicacion.
- proxy.php: proxy para resolver CORS de feeds.
- sw.js: cache y comportamiento offline.
- manifest.webmanifest: metadatos PWA.

## Uso local rapido

1. Servir el proyecto con un servidor que soporte PHP.
2. Abrir la app en el navegador.
3. Iniciar sesion en Puter (opcional, recomendado para persistencia cloud).
4. Crear categorias y agregar feeds.

Ejemplo con servidor embebido de PHP:

```bash
php -S localhost:8080
```

## Flujo recomendado de uso

1. Crea una categoria.
2. Agrega una URL (sitio o feed) y usa Buscar fuentes si hace falta.
3. Consulta noticias recientes y usa filtros para encontrar contenido.
4. Usa Resumir para obtener una version corta por IA.
5. Exporta backup JSON periodicamente.

## Mejoras de profesionalizacion ya aplicadas

- Estado visible de refresco en la cabecera.
- Boton de reintento para feeds fallidos.
- Mensajes toast para feedback rapido.
- Estado vacio explicito para primera ejecucion o filtros sin resultados.
- Timeout y mejor manejo de errores HTTP en la carga de feeds.
- Proxy endurecido contra URLs invalidas y hosts privados.
- Modo Diagnostico para monitorear estado, latencia e incidencias por feed.
- Sanitizacion reforzada de textos y URLs antes de renderizar contenido externo.
- Utilidades compartidas de parsing/validacion con tests unitarios basicos.

## Tests

Ejecutar tests unitarios de utilidades:

```bash
node tests/feed-utils.test.js
```

## CI y calidad (Fase 3)

Se agrego pipeline de GitHub Actions en [.github/workflows/ci.yml](.github/workflows/ci.yml) para ejecutar en push y pull request:

- Lint con ESLint.
- Tests unitarios de utilidades.

Comandos locales equivalentes:

```bash
npm install
npm run lint
npm test
npm run check
```

## Roadmap sugerido

- Tests unitarios para parsing y normalizacion de feeds.
- Suite E2E para flujos criticos (alta feed, refresco, lectura).
- Observabilidad de errores y metricas de rendimiento.
- Endurecer CSP y politicas de seguridad de frontend.
- Mejoras de accesibilidad (foco, teclado, labels, contraste).

## Nota Puter

La app incluye referencia visible a:

- https://developer.puter.com

## Licencia

Ver archivo LICENSE.
