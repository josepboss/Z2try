# AI Rules — Z2U Auto Fulfiller

## Tech Stack

- **Backend**: Node.js 20+, Express 5, TypeScript, Drizzle ORM (PostgreSQL), Zod validation
- **Build**: esbuild (CJS bundle), PM2 for production deployment
- **Frontend (Chrome Extension)**: Manifest V3, service workers, React for popup UI
- **Database**: PostgreSQL with Drizzle ORM (schema-first, migrations via `drizzle-kit`)
- **API Codegen**: Orval (from OpenAPI spec) → generates React Query hooks + Zod schemas
- **UI Library**: shadcn/ui (Radix UI primitives + Tailwind CSS)
- **Automation Bridge**: Local Python Flask server (`bridge.py`) + Playwright for Chrome CDP
- **Deployment**: VPS (Ubuntu/Debian), PM2 process manager, optional Nginx reverse proxy with Certbot

## Library Usage Rules

### Backend (`artifacts/api-server`)

- **HTTP/Router**: Use Express 5 only. Do not引入 Fastify, Hono, or other frameworks.
- **Database**: Use Drizzle ORM exclusively. Never use raw `pg` client or Prisma.
- **Validation**: Use Zod for all request/response schemas and form validation.
- **File Processing**: Use `exceljs` for XLSX generation; `adm-zip` for ZIP/ZIP-like operations.
- **HTTP Client**: Use `axios` for external API calls (e.g., Lfollowers API).
- **Logging**: Use `pino` with `pino-http` middleware. Do not use `console.log` in production code.
- **Environment**: Load `.env` via `dotenv` at startup; always validate required variables.

### API Client (`lib/api-client-react`)

- **HTTP Client**: Use `customFetch` from `@workspace/api-client-react/custom-fetch`. Never use raw `fetch` or `axios` in React code.
- **Data Fetching**: Use React Query (`@tanstack/react-query`) for all server state. Never use `useEffect` for data fetching.
- **Auth**: Use `setAuthTokenGetter` to register a token getter. Do not manually attach Authorization headers.

### API Spec & Zod (`lib/api-spec`, `lib/api-zod`)

- **Schema Source**: Always edit `lib/api-spec/openapi.yaml` first. Never edit generated files directly.
- **Codegen**: Run `pnpm --filter @workspace/api-spec run codegen` after any OpenAPI changes.
- **Validation**: Use generated Zod schemas (`@workspace/api-zod`) for request/response validation.

### UI Components (`artifacts/mockup-sandbox`)

- **Styling**: Use Tailwind CSS only. Never write raw CSS files.
- **Primitives**: Use shadcn/ui components (import from `@/components/ui`). Do not create new primitives unless absolutely necessary.
- **Icons**: Use `lucide-react` for all icons.
- **Forms**: Use `react-hook-form` + `@hookform/resolvers/zod` for all forms.

### Chrome Extension (`chrome-extension/`)

- **State**: Use `chrome.storage.local` for user settings and processed order history.
- **Alarms**: Use `chrome.alarms` for scheduling (e.g., order refresh every 45–90s).
- **Background**: Keep service worker logic minimal. Use `chrome.runtime.sendMessage` for cross-context communication.
- **Content Scripts**: Inject `injected.js` at `document_start` to capture upload endpoints before Z2U loads.

### Bridge & Automation (`bridge.py`)

- **Connection**: Use Playwright `connect_over_cdp` to attach to an existing Chrome instance.
- **Upload**: Always use `page.set_input_files` or `expect_file_chooser()` for file uploads. Never rely on CDP DOM manipulation alone.
- **Error Handling**: Log every step to stdout. Return structured JSON responses for the extension to parse.

## General Rules

- **No console.log**: Replace all `console.log` with `logger.info/warn/error` in backend code.
- **Type Safety**: Enable `strict: true` in all `tsconfig.json` files. Never use `any`.
- **Error Messages**: Always include context (e.g., `{ err, orderId }`) in error logs.
- **Security**: Never commit API keys or secrets. Use `.env.example` for required variables.
- **Testing**: Add unit tests for new backend routes and Zod schemas. No formal test framework yet — use `vitest` if needed.
- **Deployment**: Always run `pnpm run build` before pushing to VPS. Use PM2 for process management.

## Database Rules

- **Schema Changes**: Edit `lib/db/src/schema/index.ts` directly. Run `pnpm --filter @workspace/db run push` to apply changes (dev only).
- **Migrations**: Generate migrations via `drizzle-kit generate` if manual schema edits are complex.
- **Production**: Never run `push` on VPS. Use migrations for schema updates in production.

## API Design Rules

- **RESTful**: Use standard HTTP methods (GET/POST/PUT/DELETE) and resource paths.
- **Error Responses**: Return structured JSON with `error` field on non-2xx status codes.
- **Idempotency**: Design endpoints to be idempotent where possible (e.g., order processing).
- **Documentation**: Update `openapi.yaml` for every new endpoint or schema change.