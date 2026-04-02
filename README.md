# @nodeknit/app-inertiajs

`@nodeknit/app-inertiajs` is a minimal SSR adapter for NodeKnit applications.

It lets you render React components on the server inside the existing `Express` runtime managed by `@nodeknit/app-manager`.

Current scope:

- register SSR pages through a NodeKnit collection
- render React with `react-dom/server`
- return full HTML from Express routes
- serialize page props into the response

Current non-goals:

- full Inertia.js protocol compatibility
- client hydration
- Vite integration
- client-side navigation

## Why this exists

In the current NodeKnit architecture, applications are mounted into a shared `Express` runtime by `app-manager`.

That makes it more practical to add a small SSR layer first than to introduce a full framework runtime immediately.

This module is intended as that first step.

## Installation

Add the package to the root project:

```json
{
  "dependencies": {
    "@nodeknit/app-inertiajs": "file:./local_modules/app-inertiajs",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  }
}
```

Then install dependencies:

```bash
npm install
```

## API

The package exports `AppInertiajs`.

You extend it and fill the `inertiaPages` collection.

Each page definition supports:

- `route`: Express route path
- `component`: React component to render
- `props`: static object or async resolver
- `title`: static title or resolver
- `status`: optional HTTP status code

## Example

```ts
import React from "react";
import type { Request } from "express";
import { AppInertiajs, type InertiaPageProps } from "@nodeknit/app-inertiajs";
import { AppManager } from "@nodeknit/app-manager";

function DemoPage(props: InertiaPageProps): React.ReactElement {
  return React.createElement(
    "main",
    null,
    React.createElement("h1", null, "SSR demo"),
    React.createElement("p", null, `Request path: ${props.requestPath}`)
  );
}

export default class AppFrontend extends AppInertiajs {
  appId = "app-frontend";
  name = "Frontend";

  inertiaPages = [
    {
      route: "/ssr-test",
      component: DemoPage,
      title: "SSR Test",
      props: async (req: Request, _appManager: AppManager) => {
        return {
          requestPath: req.path,
        };
      },
    },
  ];
}
```

Mount it during bootstrap:

```ts
const appFrontend = new AppFrontend(appManager);
await appFrontend._mount();
```

## Response format

The route returns a full HTML document.

Rendered markup is inserted into:

```html
<div id="app" data-page="...">...</div>
```

`data-page` is intended as the future handoff point for client hydration.

## Project example

A working example exists in this repository:

- `apps/app-cbs-hmrn-frontend/index.ts`

After starting the runtime:

```bash
npm run start
```

Open:

```text
http://127.0.0.1:17280/ssr-test
```

## Recommended next steps

If you want to evolve this into a more complete frontend adapter, the next steps are:

1. Add a client entry with `hydrateRoot`.
2. Build client assets with Vite.
3. Add a page registry instead of inline component references.
4. Add shared props and layouts.
5. Decide whether to implement official Inertia protocol semantics or keep a simpler NodeKnit-specific SSR contract.
