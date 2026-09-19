# Appica Workspace

Follow the repository root `../../AGENTS.md` and `../AGENTS.md` for frontend development.

- Appica is an independent new-api frontend template. Keep source and build output inside this directory.
- Use Bun, React, TypeScript, Rsbuild, and Tailwind CSS, consistent with `web/`.
- Before adding UI, read `../../.agents/skills/shadcn-ui/SKILL.md` and inspect matching components in `../src/components/` and related features.
- Keep branding and copyright attribution for new-api and QuantumNous.
- Use `src/i18n/locales/{lang}.json` with English source strings as translation keys.
- `bun run build` outputs to `web/appica/dist`; publishing into `web/dist` is a separate operation. Both locations are relative to the repository root.
- Run typecheck, lint, format checks, and a production build for scaffold changes. Add focused behavior tests when introducing application features.

## Appica UI
- Tailwind CSS v4 only. Do NOT create a `tailwind.config.js` - v4 config lives in CSS via `@theme`.
  If the project is on v3, convert unsupported syntax rather than downgrading the components.
- Scan the library for class names or everything renders unstyled: `@source '../node_modules/@appica/ui-react/dist';`
  in the stylesheet that imports Tailwind. The path is relative to that stylesheet - count the `../`
  needed to reach the project root. A bare package name resolves to nothing and fails silently.
- React 19 is a hard requirement. No `forwardRef` - `ref` is a plain prop.
- Import from the subpath, one component per import:
  `import { Button } from '@appica/ui-react/button'`.
- Never write hex colors, px radii, or duration literals. Use the role-based tokens:
  `bg-background-muted`, `text-foreground-intense`, `border-border-strong`, `var(--radius-md)`.
  Full list: https://appica.dev/ui/docs/react/colors.md
- Never write hue-based utilities (`bg-gray-100`, `text-slate-600`). The palette is organized by
  role, not hue.
- Prefer v4 variant syntax (`*:`, `**:`, `data-*:`, `not-*:`) over `[&_...]` arbitrary selectors.
- For a link styled as a button, put `buttonVariants(...)` on the `<a>` - never `<Button render={<a/>}>`.
- Put `className` overrides on the wrapper component, not on the JSX passed to `render`.
- Do not hand-roll a component that exists in the library. Check the component list first:
  https://appica.dev/llms.txt
- Every documentation page is served as clean markdown at `<url>.md` - fetch that, not the HTML.