# Deployment architecture decision

## Decision

Deploy the current hackathon build as a static Vite application on Vercel. A
backend is not required for the current WebMCP, WebGPU, module-worker, Wasm,
local import, or local export path. Vercel should remain the web/control plane
when the product later adds persistence and remote engineering solvers; serious
CAD, meshing, FEA, CFD, or GPU jobs should run in a separate compute plane.

This is not a guess about the current code:

- `package.json` builds a Vite SPA into `dist`; Vite documents Vercel's automatic
  Vite detection and static deployment flow.
- `src/optimization/topology-probe-client.ts` starts a same-origin module worker.
- `src/optimization/topology-probe.worker.ts` runs the optimizer and transfers
  typed-array buffers back to the page.
- `src/reference/index.ts` dynamically loads the Rust/Wasm reference solver.
- `src/gpu/capabilities.ts` acquires WebGPU in the browser and reports unsupported
  or lost devices explicitly.
- `src/webmcp/use-foundation-tools.ts` registers page-local tools on
  `document.modelContext`.
- Production source has no application API, database, remote solver, WebSocket,
  or project persistence; only the theme is stored in `localStorage`.
- The present production bundle is about 31 MB. Its largest static asset is a
  9.7 MB GLB; the OCCT and reference-solver Wasm assets are about 7.6 MB and
  179 KB respectively.

Vite's official guide confirms that the default static output is `dist` and that
Vercel detects Vite and applies the appropriate build settings:
<https://vite.dev/guide/static-deploy.html#vercel>.

## What the first deployment needs

1. Import the Git repository into Vercel or run the Vercel CLI. Use the Vite
   preset, `pnpm build`, and `dist`. The repository pins Node `24.19.0` in both
   `.nvmrc` and `package.json`.
2. Use one stable production/custom origin for judging. Vercel preview URLs are
   useful for ordinary UI review, but not as the canonical WebMCP origin.
3. Enroll that stable origin in the Chrome 149 WebMCP origin trial and serve its
   token before application JavaScript accesses the API. Chrome's official
   WebMCP documentation describes the trial, the local testing flag, the
   origin-isolation requirement, and the default `tools 'self'` permissions
   policy: <https://developer.chrome.com/docs/ai/webmcp>. Chrome's origin-trial
   guide requires the token's registered origin to match the page origin:
   <https://developer.chrome.com/docs/web-platform/origin-trials>.
4. Keep WebMCP progressive. Chrome calls it a proposed standard/origin trial,
   and the draft Community Group report is not a W3C Recommendation:
   <https://webmachinelearning.github.io/webmcp/>. The workbench must still be
   usable by a human when `document.modelContext` is absent.
5. Validate the exact public URL in the target Chrome/in-app browser. Passing on
   `localhost` with Chrome's testing flag is not equivalent to an origin-trial
   production proof.

## Vercel response configuration

`vite.config.ts` currently sets COOP and COEP only on Vite's development server;
those headers do not configure Vercel. Add a production `vercel.json` before the
first public deployment. The minimum static configuration is conceptually:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Origin-Agent-Cluster", "value": "?1" },
        { "key": "X-Content-Type-Options", "value": "nosniff" }
      ]
    }
  ]
}
```

Vercel supports route-level response headers in `vercel.json`:
<https://vercel.com/docs/project-configuration/vercel-json>. The origin-trial
token may be delivered as an `Origin-Trial` response header or a head `<meta>`
element; do not commit a placeholder or assume a token registered for the stable
domain will work on unrelated random preview origins. Chrome's troubleshooting
guide identifies wrong-origin and subdomain-matching failures explicitly:
<https://developer.chrome.com/docs/web-platform/origin-trial-troubleshooting>.

Do **not** add COOP/COEP merely because the site uses ordinary Wasm, a module
worker, WebGPU, or WebMCP. The current generated OCCT and Rust loaders do not use
`SharedArrayBuffer` or Wasm threads. Cross-origin isolation becomes necessary if
the solver adopts shared Wasm memory/threads. At that point add:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

and gate release on `window.crossOriginIsolated === true`. This pair enables
shared-memory capabilities but can block third-party resources that do not opt
in through CORS/CORP, so it must be tested against remote CAD and embedded agent
surfaces before enforcement. See Google's COOP/COEP deployment guidance:
<https://web.dev/articles/coop-coep>.

## Public-URL release gates

Automate or record all of these against the deployed origin:

- Main document is HTTPS. WebGPU and WebMCP are secure-context APIs; the WebGPU
  specification exposes `navigator.gpu` only in secure contexts:
  <https://gpuweb.github.io/gpuweb/#navigator-gpu>.
- Both `.wasm` responses return `200` and `Content-Type: application/wasm`.
  Streaming Wasm compilation validates the response MIME type:
  <https://webassembly.github.io/spec/web-api/#streaming-modules>.
- The hashed module-worker entry returns JavaScript, starts without CSP/CORS
  errors, and a completed solve returns transferred result fields.
- `navigator.gpu`, adapter acquisition, device acquisition, device-loss handling,
  and the Rust/Wasm solve are each reported separately. HTTPS cannot guarantee a
  compatible/non-blocklisted GPU; Chrome documents those runtime failure modes:
  <https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips>.
- The origin trial is shown as valid in Chrome DevTools; `document.modelContext`
  exists; tools register; and the exact generate -> inspect -> solve -> compare
  path works through the browser agent.
- If the site is cross-origin embedded, its host explicitly grants `allow="tools"`.
  Otherwise the WebMCP permissions policy defaults to `self`.
- Tool descriptions and outputs label external/user content as untrusted and
  state-changing operations retain human approval. Chrome's first-party security
  guidance covers `readOnlyHint`, `untrustedContentHint`, and trusted origins:
  <https://developer.chrome.com/docs/ai/webmcp/secure-tools>.

## When a backend becomes necessary

Add a thin backend when any of these becomes a product requirement:

- accounts, access control, shared projects, cross-device state, multiplayer
  editing, durable branches/undo, approvals, audit logs, or provenance;
- uploaded STEP/mesh inputs, screenshots, result fields, solver logs, or exports
  that must survive a browser session;
- server-side agent runs, secrets, quotas, billing, organization policies, or
  reproducible job submission;
- remote/native solvers, jobs longer than an interactive browser task, retry,
  cancellation, progress, scheduling, or hardware chosen independently of the
  user's laptop.

The smallest credible next architecture is:

```text
Browser / WebMCP / Three.js / local WebGPU estimates
                  |
                  v
Vercel static UI + thin auth/metadata/job API
                  |
       +----------+-----------+
       |                      |
 project database      object/artifact store
       |                      |
       +------> durable queue <+
                         |
                         v
             native CPU/GPU solver workers
```

Use Vercel Functions for short control-plane requests, not as the engineering
compute plane. Current official limits include 2 GB/1 vCPU on Hobby, up to
4 GB/2 vCPU on Pro/Enterprise, a 250 MB uncompressed function bundle, a 4.5 MB
request/response payload, and Fluid Compute maximum durations of 300 seconds on
Hobby and 800 seconds on Pro/Enterprise:
<https://vercel.com/docs/functions/limitations>. The current 9.7 MB GLB already
exceeds the Function payload limit if proxied through an API route.

Upload large CAD and result artifacts directly to object storage with a short
server-issued token. Vercel's own Blob guidance recommends browser-direct upload
for files larger than 4.5 MB:
<https://vercel.com/docs/vercel-blob/client-upload>. Submit only immutable object
references, study parameters, units, checksums, and revision IDs to the job API.

Use a durable queue once jobs need retry or outlive the request. Vercel Queues is
currently Beta and provides at-least-once delivery, so consumers must be
idempotent; its poll mode can feed workers outside Vercel:
<https://vercel.com/docs/queues> and
<https://vercel.com/docs/queues/poll-mode>. A stable Postgres-backed job table or
another mature managed queue is also reasonable. The queue does not make a
Vercel Function a suitable native/GPU solver.

## Staged recommendation

| Stage | Deploy | Explicitly defer |
| --- | --- | --- |
| Hackathon | Vercel static CDN, stable origin, WebMCP trial token, browser worker/Wasm/WebGPU, public-url evidence | Auth, database, queues, remote solvers, multiplayer |
| Foundation | Thin API, auth, project/revision metadata, direct object uploads, immutable job records | Running large solver binaries inside request handlers |
| Engineering platform | Durable queue/workflow, independent container/GPU workers, progressive artifacts, cancellation, validation ledger, realtime collaboration service | Treating Vercel Functions or browser WebGPU estimates as validated FEA/CFD |

The practical verdict is therefore **Vercel now, hybrid later**. Building a
backend before the public browser flow is proven would add failure modes without
serving the hackathon. Treating the static deployment as the final platform
would be equally wrong once designs, evidence, collaboration, and solver jobs
must be durable.
