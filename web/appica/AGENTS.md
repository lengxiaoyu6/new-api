# Appica Workspace

Follow the repository root `../../AGENTS.md` and `../AGENTS.md` for frontend development.

- Appica is an independent new-api frontend template. Keep source and build output inside this directory.
- Use Bun, React, TypeScript, Rsbuild, and Tailwind CSS, consistent with `web/`.
- Before adding UI, read `../../.agents/skills/shadcn-ui/SKILL.md` and inspect matching components in `../src/components/` and related features.
- Keep branding and copyright attribution for new-api and QuantumNous.
- Use `src/i18n/locales/{lang}.json` with English source strings as translation keys.
- `bun run build` outputs to `web/appica/dist`; publishing into `web/dist` is a separate operation. Both locations are relative to the repository root.
- Run typecheck, lint, format checks, and a production build for scaffold changes. Add focused behavior tests when introducing application features.
