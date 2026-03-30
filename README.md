# Cloudflare Browser Rendering Microservice

A serverless API built on Cloudflare Workers that utilizes the [Cloudflare Browser Rendering API](https://developers.cloudflare.com/browser-rendering/) to execute headless Chromium instances.

By default, this project is configured to render [Mermaid.js](https://mermaid.js.org/) diagrams into perfectly sized SVGs, but it can be adapted for any headless browser task (PDF generation, web scraping, automated testing).

## 🚀 Features

- **Serverless Headless Chrome:** No need to manage heavy Docker containers or EC2 instances.
- **Exact Font Metrics:** Generates SVGs that perfectly match your frontend fonts, preventing text overflow.
- **Asset Injection:** Supports loading external stylesheets (like FontAwesome) prior to execution.
- **Secure:** Protected by Bearer token authentication.

---

## 🛠️ Setup & Deployment

### 1. Prerequisites

- A Cloudflare account with **Workers Paid** plan (or Free tier with Browser Rendering enabled in settings).
- Node.js v20+ and `npm`.

### 2. Installation

Clone the repository and install dependencies:
\`\`\`bash
npm install
\`\`\`

_(Note: If using the provided `.devcontainer`, this happens automatically)._

### 3. Configuration

Ensure your `wrangler.json` includes the browser binding:
\`\`\`json
{
"name": "mermaid-svg-renderer",
"main": "src/index.ts",
"compatibility_date": "2026-03-11",
"browser": {
"binding": "BROWSER"
}
}
\`\`\`

### 4. Security (API Key)

Generate a secure random string and add it to your Cloudflare Secrets. This prevents unauthorized usage of your Browser Rendering quota.
\`\`\`bash
npx wrangler secret put API_KEY
\`\`\`
_(For local development, create a `.dev.vars` file with `API_KEY=your_dev_secret_here`)._

### 5. Deployment

Publish the worker to Cloudflare's global network:
\`\`\`bash
npm run deploy
\`\`\`

---

## 📡 API Usage & Integration

Send a `POST` request to your Worker's URL. The payload must be JSON.

### Endpoint

\`POST https://<YOUR_WORKER_URL>\`

### Request Body

\`\`\`json
{
"code": "graph TD;\n A-->B;",
"config": {
"theme": "base",
"themeVariables": { "primaryColor": "#ff0000" }
},
"fontFamily": "Inter, sans-serif"
}
\`\`\`

### Example: Calling from another Cloudflare Worker

If you are calling this service from _another_ Cloudflare Worker on the same account, you can use [Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/service-bindings/) to bypass the public internet entirely, reducing latency and costs.

\`\`\`typescript
export default {
async fetch(request, env) {
// Assuming you bound this renderer worker to 'MERMAID_SERVICE'
const response = await env.MERMAID_SERVICE.fetch(
new Request("https://internal-mermaid/render", {
method: "POST",
headers: {
"Content-Type": "application/json",
"Authorization": `Bearer ${env.RENDERER_API_KEY}`
},
body: JSON.stringify({ code: "pie title Pets \n \"Dogs\" : 386 \n \"Cats\" : 85" })
})
);

    const svg = await response.text();
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml" }});

}
};
\`\`\`

### Example: Calling from a Node.js / Astro Build process

\`\`\`typescript
const response = await fetch("https://mermaid-svg-renderer.your-subdomain.workers.dev", {
method: "POST",
headers: {
"Content-Type": "application/json",
"Authorization": "Bearer YOUR_SECRET_KEY"
},
body: JSON.stringify({
code: "sequenceDiagram\n Alice->>John: Hello John, how are you?",
fontFamily: "'Noto Sans Display', system-ui, sans-serif"
}),
signal: AbortSignal.timeout(30_000) // Browsers take time to boot
});

if (!response.ok) throw new Error(`Render failed: ${response.statusText}`);
const svgData = await response.text();
\`\`\`

---

## 🧠 Best Practices & Gotchas

- **Timeouts:** Browser cold starts can take 2–5 seconds. Always set a high timeout (e.g., 30s - 45s) on the client side making the `fetch` request.
- **Caching:** Never call this API on every user page load. Use it primarily at **build time** (SSG) or place a CDN cache/KV store in front of it.
- **Font Synchronization:** The headless browser uses standard Linux fonts. If your frontend uses custom web fonts, pass them exactly as they appear in your CSS via the `fontFamily` payload property, or inject a `<style> @import url(...) </style>` block in the Worker to guarantee precise text-width calculation.
- **Concurrency Limitations:** Cloudflare imposes limits on concurrent browser instances. For large batch jobs (e.g., generating 100 diagrams at once), implement a queue or batch the rendering requests sequentially to avoid HTTP 429 Too Many Requests errors.
