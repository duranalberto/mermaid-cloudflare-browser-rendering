/**
 * Cloudflare Browser Rendering Worker — Mermaid SVG Renderer
 *
 * ## Modes
 *
 * ### Batch mode (Optimized)
 * POST { batch: Array<{ id: string, code: string }>, themes: Record<string, MermaidConfig>, fontFamily? }
 * → { results: { [id]: { [themeName]: "<svg…>" } } }
 *
 * Launches the browser ONCE. For each diagram, renders all themes using
 * hard isolation (page.goto('about:blank')) to prevent ID collisions.
 */

import puppeteer, {
  type Browser,
  type BrowserWorker,
} from "@cloudflare/puppeteer";

export interface Env {
  BROWSER: BrowserWorker;
  API_KEY: string;
}

type MermaidConfig = Record<string, unknown>;

interface SingleThemeBody {
  code: string;
  config?: MermaidConfig;
  fontFamily?: string;
}

interface MultiThemeBody {
  code: string;
  themes: Record<string, MermaidConfig>;
  fontFamily?: string;
}

interface BatchItem {
  id: string;
  code: string;
}

interface BatchBody {
  batch: BatchItem[];
  themes: Record<string, MermaidConfig>; // Optimized: themes lifted to root
  fontFamily?: string;
}

type RequestBody = SingleThemeBody | MultiThemeBody | BatchBody;

const DIAGRAM_ERROR_SVG = `<svg id="mermaid-error" viewBox="0 0 200 60" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="60" fill="none" stroke="#ccc" stroke-width="1" rx="4"/><text x="100" y="34" text-anchor="middle" font-size="12" fill="#999" font-family="sans-serif">Diagram unavailable</text></svg>`;

function isMultiTheme(body: RequestBody): body is MultiThemeBody {
  return (
    "themes" in body &&
    !("batch" in body) &&
    typeof (body as MultiThemeBody).themes === "object"
  );
}

function isBatch(body: RequestBody): body is BatchBody {
  return "batch" in body && Array.isArray((body as BatchBody).batch);
}

function mergeFont(config: MermaidConfig, fontFamily: string): MermaidConfig {
  return {
    ...config,
    themeVariables: {
      ...(config.themeVariables as MermaidConfig | undefined),
      fontFamily,
    },
  };
}

function pageHtml(fontFamily: string): string {
  return `<html>
    <head>
      <script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css">
      <style>body { font-family: ${fontFamily}; margin: 0; padding: 0; }</style>
    </head>
    <body><div id="graph"></div></body>
  </html>`;
}

/**
 * Renders all themes for a single diagram.
 * * Isolation Strategy: Instead of simple innerHTML clears, we navigate to
 * about:blank and re-inject the page shell for every theme. This is the
 * only way to ensure Mermaid's internal JS registry and CSS counters
 * are fully wiped between renders.
 */
async function renderDiagramAllThemes(
  browser: Browser,
  id: string,
  code: string,
  themes: Record<string, MermaidConfig>,
  fontFamily: string,
): Promise<Record<string, string>> {
  const page = await browser.newPage();
  const results: Record<string, string> = {};

  try {
    for (const [themeName, themeConfig] of Object.entries(themes)) {
      // Hard Isolation: Wipe the execution context completely
      await page.goto("about:blank");
      await page.setContent(pageHtml(fontFamily));

      const mergedConfig = mergeFont(themeConfig, fontFamily);
      const renderId = `res-${themeName}-${Math.floor(Math.random() * 10000)}`;

      try {
        const svg: string = await page.evaluate(
          async (mCode: string, mConfig: MermaidConfig, mRenderId: string) => {
            const { mermaid } = window as any;
            // Always initialize per-theme to ensure variables are applied
            mermaid.initialize({ ...mConfig, startOnLoad: false });
            const result = await mermaid.render(mRenderId, mCode);
            return result.svg;
          },
          code,
          mergedConfig,
          renderId,
        );

        results[themeName] = svg;
      } catch (themeErr) {
        console.error(`[worker:render] "${id}" theme "${themeName}" FAILED`);
        results[themeName] = DIAGRAM_ERROR_SVG;
      }
    }
    return results;
  } finally {
    await page.close();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const t0 = performance.now();

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const clientToken = request.headers.get("X-Auth-Token");
    if (env.API_KEY && clientToken !== env.API_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }

    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > 950_000) {
      return new Response("Payload too large", { status: 413 });
    }

    let browser: Browser | undefined;

    try {
      const body = (await request.json()) as RequestBody;
      browser = await puppeteer.launch(env.BROWSER);

      // ── Optimized Batch mode ─────────────────────────────────────────────
      if (isBatch(body)) {
        const { batch, themes, fontFamily = "sans-serif" } = body;

        if (!themes || Object.keys(themes).length === 0) {
          return new Response("Missing 'themes' at batch root", {
            status: 400,
          });
        }

        const results: Record<string, Record<string, string>> = {};

        for (const item of batch) {
          results[item.id] = await renderDiagramAllThemes(
            browser,
            item.id,
            item.code,
            themes, // Shared themes used for every item
            fontFamily,
          );
        }

        const totalMs = Math.round(performance.now() - t0);
        return new Response(JSON.stringify({ results }), {
          headers: {
            "Content-Type": "application/json",
            "X-Render-Time": String(totalMs),
          },
        });
      }

      // ── Multi-theme mode (Legacy) ────────────────────────────────────────
      if (isMultiTheme(body)) {
        const { code, themes, fontFamily = "sans-serif" } = body;
        const renderResults = await renderDiagramAllThemes(
          browser,
          "multi",
          code,
          themes,
          fontFamily,
        );

        return new Response(JSON.stringify(renderResults), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // ── Single-theme mode (Legacy) ───────────────────────────────────────
      const {
        code,
        config = {},
        fontFamily = "sans-serif",
      } = body as SingleThemeBody;
      const themeResults = await renderDiagramAllThemes(
        browser,
        "single",
        code,
        { render: config },
        fontFamily,
      );

      return new Response(themeResults["render"] ?? "", {
        headers: { "Content-Type": "image/svg+xml" },
      });
    } catch (error: any) {
      return new Response(
        JSON.stringify({ error: "Failed", details: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    } finally {
      if (browser) {
        await Promise.race([
          browser.close(),
          new Promise<void>((resolve) => setTimeout(resolve, 3000)),
        ]);
      }
    }
  },
};
