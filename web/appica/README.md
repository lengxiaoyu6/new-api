# Appica

Independent frontend template workspace for new-api by QuantumNous, located at `web/appica/`.

## Development

From this directory:

```bash
bun install
bun run dev
```

The development server defaults to `http://localhost:5174`. If the port is occupied, Rsbuild selects another available port.

API requests are proxied to `http://localhost:3000`. Set `VITE_REACT_APP_SERVER_URL` in `.env.local` or the process environment to use another backend. This setting only configures the development proxy.

## Source

- `src/App.tsx`: initial template entry.
- `src/styles/index.css`: template styles and Tailwind entry.
- `src/i18n/`: translations and language detection.
- `public/`: static assets, including the existing new-api logo.
- `rsbuild.config.ts`: development proxy and independent build configuration.

This scaffold contains the template identity only. Application pages and API integration can be added as the template is developed.

## Validation And Build

```bash
bun run typecheck
bun run lint
bun run format:check
bun run build
```

The build outputs to `web/appica/dist`, relative to the repository root. It does not replace `web/dist` or change the backend's active frontend. The lint and format scripts reuse the parent configuration in `web/`.

To publish with the Go service, replace `web/dist` with the complete Appica build output before compiling the backend. Docker builds also need their frontend build stage updated to use Appica. Standalone static hosting requires API reverse proxying and SPA fallback configuration.
