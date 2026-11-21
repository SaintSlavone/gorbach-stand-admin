# Project Architecture

Reusable initialization guide for Next.js projects. Apply these conventions to new projects unless the project brief or existing repository instructions say otherwise. Inspect an existing codebase first and preserve its established conventions instead of silently restructuring it.

## Stack

- Next.js with the App Router and React.
- TypeScript and TSX for application code and React components.
- SCSS (`sass`) for styling.
- Use versions specified by the project. Do not copy versions or dependencies from another project without checking compatibility and need.

## Structure

For a new project, use the following starting layout and add folders only as needed:

```text
project-root/
├── src/
│   ├── app/                    # App Router routes, layouts, and route handlers
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── api/                # Server route handlers, if needed
│   ├── api/                    # API client and API-specific hooks, if needed
│   │   └── hooks/
│   ├── components/             # Shared UI components
│   │   └── example-card/
│   │       ├── ExampleCard.tsx
│   │       ├── ExampleCard.scss
│   │       └── Adaptations.scss
│   ├── contexts/               # React contexts and providers, if needed
│   ├── hooks/                  # Non-API-specific hooks
│   ├── styles/                 # Global styles and design tokens
│   │   ├── _colors.scss
│   │   └── style.scss
│   └── utils/                  # Shared utilities
├── tsconfig.json
└── package.json
```

- Keep `app/` inside `src/` as `src/app/`.
- Keep route-specific styles alongside the route; keep shared components in `src/components/`.
- Create a color token file in `src/styles/_colors.scss` and define the project's palette there. Use the tokens rather than hardcoded colors in component styles.
- Do not invent a typography mixin system. Add one only when requested or already defined by the project.

## Imports

- Configure `@/*` as an alias for the `src/` directory in `tsconfig.json`, merging the following into the existing configuration:

```json
{
	"compilerOptions": {
		"baseUrl": ".",
		"paths": {
			"@/*": ["./src/*"]
		}
	}
}
```

- Prefer `@/` for TypeScript and TSX imports; keep imports consistent within each file.
- Use relative paths for SCSS imports. For example, adjust the path to match the actual file location:

```scss
@use "../../styles/_colors.scss" as *;
```

- Match the exact case of every filename in imports to avoid failures on case-sensitive systems.

## Code style

### Components and TypeScript

- Use PascalCase component filenames and kebab-case component directories: `example-card/ExampleCard.tsx`.
- Default-export component functions and destructure props in the function signature.
- Name internal event handlers `handleX` and callback props `onX`.
- Use Server Components by default; add `"use client"` only when client-side features require it.
- Define TypeScript types or interfaces for component props; use JSDoc for non-obvious behavior where useful. Write comments in English, explaining why rather than repeating what the code does. Preserve existing comments unless changing them is necessary.

### SCSS

- Use kebab-case class names, for example `.project-card` and `.card-close-btn`.
- Match the main SCSS filename to its component exactly, including case: `ExampleCard.tsx` and `ExampleCard.scss`.
- Nest component selectors under a single root class:

```scss
.example-card {
	.example-card-title {
		color: $primary_color1;
	}
}
```

- Keep responsive media queries in a separate `Adaptations.scss` alongside the main stylesheet for both pages and components. Import it so its styles are included.
- Use the following mobile breakpoints unless the project specifies others:

```scss
@media screen and (max-width: 600px) and (max-height: 1000px) and (orientation: portrait) {
	// Portrait adaptations
}

@media screen and (max-width: 1000px) and (max-height: 600px) and (orientation: landscape) {
	// Landscape adaptations
}
```

- Define colors as hex values in the color token file; use variables elsewhere. Define token names for the actual project palette.

### Formatting

Configure Prettier when it is part of the project:

```json
{
	"useTabs": true,
	"tabWidth": 1,
	"printWidth": 90,
	"singleQuote": false,
	"semi": true,
	"trailingComma": "all",
	"endOfLine": "lf"
}
```

## Commands

Check `package.json`, the lockfile, and the installed tool versions before running commands. For a new npm-based project, define and document the scripts that actually exist. Typical commands are:

| Purpose               | Command          | Condition                                               |
| --------------------- | ---------------- | ------------------------------------------------------- |
| Install dependencies  | `npm install`    | Use the project's package manager and lockfile.         |
| Development server    | `npm run dev`    | Requires a `dev` script.                                |
| Production build      | `npm run build`  | Requires a `build` script.                              |
| Run production server | `npm start`      | Requires a `start` script and a successful build.       |
| Lint                  | `npm run lint`   | Only if a `lint` script is configured.                  |
| Format                | `npm run format` | Only if a `format` script and formatter are configured. |

Do not assume `next lint` exists in every Next.js version or fetch a formatter with `npx` without checking the project setup. Run checks relevant to the work and report failures.

## Initialization checklist

1. Read the project brief and existing repository instructions. Check for an existing project before creating or overwriting files.
2. Confirm the requested stack, package manager, and dependencies; initialize the app only if needed.
3. Set up the applicable structure, import alias, color tokens, and formatting configuration above.
4. Add scripts only for tools that are installed and configured; record any project-specific commands.
5. Verify the application with the available checks and report what was created and any issues.
