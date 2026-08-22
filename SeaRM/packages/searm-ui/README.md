<p align="center">
  <img src="https://raw.githubusercontent.com/Vatsa10/Harbour/main/packages/searm-ui/logo.png" width="136" height="136" alt="searm-ui logo" />
</p>

# searm-ui

SeaRM's open-source React UI component library: components, icons, and design tokens built on a zero-runtime, CSS-variable styling layer.

# Installation

```bash
npm install searm-ui
```

`react`, `react-dom`, and `monaco-editor` are peer dependencies (install them in your app). `monaco-editor` is only required if you use the code editor components.

# Usage

Import the base styles once, pick a theme stylesheet, and wrap your app in `ThemeProvider`:

```tsx
import { ThemeProvider } from 'searm-ui/theme-constants';
import { Button } from 'searm-ui/input';

import 'searm-ui/style.css';
import 'searm-ui/theme-light.css';

export const App = () => (
  <ThemeProvider colorScheme="light">
    <Button title="Click me" />
  </ThemeProvider>
);
```

Components are available from the root entry point or from a specific subpath for better tree-shaking:

```tsx
import { Button } from 'searm-ui';
import { Button } from 'searm-ui/input';
```

# Entry points

| Subpath | Contents |
| --- | --- |
| `searm-ui` | All components, icons, theme tokens, and utilities |
| `searm-ui/accessibility` | Accessibility helpers |
| `searm-ui/assets` | Logos and static assets |
| `searm-ui/data-display` | Avatars, chips, tags, and other display components |
| `searm-ui/feedback` | Progress bars, loaders, and status feedback |
| `searm-ui/icon` | Icon components and the icon provider |
| `searm-ui/input` | Buttons, toggles, and form inputs |
| `searm-ui/json-visualizer` | JSON tree viewer |
| `searm-ui/layout` | Layout primitives |
| `searm-ui/navigation` | Menus, links, and navigation components |
| `searm-ui/surfaces` | Cards, tooltips, and surface components |
| `searm-ui/testing` | Storybook and test decorators |
| `searm-ui/theme` | Theme types and helpers |
| `searm-ui/theme-constants` | Design tokens, `ThemeProvider`, and `useTheme` |
| `searm-ui/typography` | Text and typography components |
| `searm-ui/utilities` | Hooks and shared utilities |

# Theming

- `searm-ui/style.css` ships the base reset and component styles. Import it once.
- `searm-ui/theme-light.css` and `searm-ui/theme-dark.css` define the design-token CSS variables for each color scheme.
- `ThemeProvider` exposes the active theme through `useTheme()` and applies the `light` / `dark` class. Pass `applyToRoot={false}` with `overrides` to scope a theme to a subtree instead of the document root.

# Development

```bash
npx nx build searm-ui                 # Build the library (dual ESM/CJS + types)
npx nx storybook:serve:dev searm-ui   # Run Storybook
npx nx test searm-ui                  # Run unit tests
```

# License

searm-ui is released under the [MIT](https://github.com/Vatsa10/Harbour/blob/main/packages/searm-ui/LICENSE) license.
