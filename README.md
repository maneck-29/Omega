# Hot Takes

Building a service with Hot Takes.

Next.js 16 (App Router) with TypeScript, Tailwind CSS v4, and API route handlers
serving the backend from the same project.

## Getting started

```bash
npm install
npm run dev
```

The app runs at http://localhost:3000.

## Scripts

| Script          | Description                          |
| --------------- | ------------------------------------ |
| `npm run dev`   | Start the development server         |
| `npm run build` | Production build                     |
| `npm start`     | Serve the production build           |
| `npm run lint`  | Run ESLint                           |

## API

| Method | Route          | Description                          |
| ------ | -------------- | ------------------------------------ |
| `GET`  | `/api/health`  | Service health and uptime            |
| `GET`  | `/api/items`   | List items                           |
| `POST` | `/api/items`   | Create an item (`{ "name": "..." }`) |

Items are held in an in-memory store (`src/lib/items.ts`), so they reset when the
server restarts. Replace it with a database when one is available.

## Project layout

```
src/
  app/
    api/health/route.ts   Health endpoint
    api/items/route.ts    Items endpoints
    add-item-form.tsx     Client component posting to the API
    layout.tsx            Root layout
    page.tsx              Home page (server component)
  lib/
    items.ts              Data layer
```

## Bundler note

`npm run build` and `npm run dev` pass `--webpack`. Next.js 16 defaults to
Turbopack, which requires native SWC bindings that need glibc 2.27+; on hosts
with older glibc (such as Amazon Linux 2, glibc 2.26) Next.js falls back to WASM
bindings and Turbopack refuses to run. Webpack works with the WASM fallback.
Drop the flags to use Turbopack on a supported platform.
