/**
 * Cloudflare Browser Rendering Worker — Mermaid SVG Renderer
 *
 * ## Single-theme mode (backward-compatible)
 *   POST { code, config?, fontFamily? }
 *   → Content-Type: image/svg+xml  (single SVG string)
 *
 * ## Multi-theme mode
 *   POST { code, themes: { light: MermaidConfig, dark: MermaidConfig, ... }, fontFamily? }
 *   → Content-Type: application/json  { light: "<svg…>", dark: "<svg…>", ... }
 *
 *   Each key in `themes` is used as the mermaid render id so the SVG root
 *   element gets id="mermaid-{themeName}". Callers use this to identify which
 *   SVG belongs to which theme without parsing CSS.
 *
 *   `fontFamily` is merged into every theme's themeVariables so mermaid uses
 *   the correct typeface for text measurement across all themes.
 */

import puppeteer, { type BrowserWorker } from "@cloudflare/puppeteer";

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

type RequestBody = SingleThemeBody | MultiThemeBody;

function isMultiTheme(body: RequestBody): body is MultiThemeBody {
  return (
    "themes" in body &&
    typeof (body as MultiThemeBody).themes === "object" &&
    (body as MultiThemeBody).themes !== null
  );
}

/**
 * Merge fontFamily into themeVariables so mermaid uses the correct typeface
 * for SVG text measurement. Setting only body { font-family } in CSS does
 * not affect SVG text layout — mermaid reads themeVariables.fontFamily.
 */
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
      <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css">
      <style>body { font-family: ${fontFamily}; margin: 0; padding: 0; }</style>
    </head>
    <body><div id="graph"></div></body>
  </html>`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const authHeader = request.headers.get("Authorization");
    if (env.API_KEY && authHeader !== `Bearer ${env.API_KEY}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    let browser;
    try {
      const body = (await request.json()) as RequestBody;
      const { code } = body;

      if (!code) {
        return new Response("Missing 'code' in request body", { status: 400 });
      }

      browser = await puppeteer.launch(env.BROWSER);

      // ── Multi-theme mode ────────────────────────────────────────────────────
      if (isMultiTheme(body)) {
        const { themes, fontFamily = "sans-serif" } = body;
        const themeEntries = Object.entries(themes);

        if (themeEntries.length === 0) {
          return new Response("'themes' must have at least one entry", {
            status: 400,
          });
        }

        const results: Record<string, string> = {};

        // Render themes sequentially — concurrent pages risk CF Browser
        // Rendering instance limits and produce non-deterministic ordering.
        for (const [themeName, themeConfig] of themeEntries) {
          const page = await browser.newPage();
          try {
            const mergedConfig = mergeFont(themeConfig, fontFamily);
            await page.setContent(pageHtml(fontFamily));

            // The render id becomes the SVG root id attribute.
            // Pattern "mermaid-{themeName}" is what transform.ts expects
            // when extracting the SVG id per theme.
            const renderId = `mermaid-${themeName}`;

            const svg: string = await page.evaluate(
              async (
                mCode: string,
                mConfig: MermaidConfig,
                mRenderId: string,
              ) => {
                const { mermaid } = window as any;
                mermaid.initialize({ ...mConfig, startOnLoad: false });
                const result = await mermaid.render(mRenderId, mCode);
                return result.svg;
              },
              code,
              mergedConfig,
              renderId,
            );

            results[themeName] = svg;
          } finally {
            await page.close();
          }
        }

        return new Response(JSON.stringify(results), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // ── Single-theme mode (backward-compatible) ─────────────────────────────
      const { config = {}, fontFamily = "sans-serif" } =
        body as SingleThemeBody;
      const mergedConfig = mergeFont(config, fontFamily);
      const page = await browser.newPage();
      await page.setContent(pageHtml(fontFamily));

      const svg: string = await page.evaluate(
        async (mCode: string, mConfig: MermaidConfig) => {
          const { mermaid } = window as any;
          mermaid.initialize({ ...mConfig, startOnLoad: false });
          const result = await mermaid.render("render-id", mCode);
          return result.svg;
        },
        code,
        mergedConfig,
      );

      return new Response(svg, {
        headers: {
          "Content-Type": "image/svg+xml",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (error: any) {
      console.error("[mermaid-renderer] Error:", error);
      return new Response(
        JSON.stringify({ error: "Rendering Failed", details: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  },
};
