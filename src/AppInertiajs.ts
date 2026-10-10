import "reflect-metadata";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToString } from "react-dom/server";
import serveStatic from "serve-static";
import type { NextFunction, Request, Response } from "express";
import type { ViteDevServer } from "vite";
import type { Server as HttpServer } from "node:http";
import {
  AbstractApp,
  AppManager,
  Collection,
  CollectionHandler,
} from "@nodeknit/app-manager";

type Serializable =
  | string
  | number
  | boolean
  | null
  | Serializable[]
  | { [key: string]: Serializable };

export type InertiaPageProps = Record<string, Serializable>;

export type InertiaPageComponent = (props: InertiaPageProps) => React.ReactElement;

export type InertiaSerializedPage = {
  component: string;
  props: InertiaPageProps;
  url: string;
  version: string;
};

export type InertiaSsrRenderResult = {
  html: string;
  head?: string[];
};

export type InertiaViteConfig = {
  rootDir: string;
  configFile?: string;
  clientEntry: string;
  ssrEntry: string;
  clientBuildDir: string;
  ssrBuildPath: string;
  assetsUrlPrefix?: string;
  devClientEntry?: string;
  version?: string;
};

export type InertiaPageDefinition = {
  route: string;
  component: string | InertiaPageComponent;
  props?:
    | InertiaPageProps
    | ((req: Request, appManager: AppManager) => InertiaPageProps | Promise<InertiaPageProps>);
  title?: string | ((props: InertiaPageProps) => string);
  status?: number;
  /** `<html lang>` for this page; overrides the app's `htmlLang`. */
  lang?: string;
};

type ManifestEntry = {
  file?: string;
  css?: string[];
  assets?: string[];
};

type Manifest = Record<string, ManifestEntry>;
type LocalCollectionItem = { appId: string; item: InertiaPageDefinition };
type SsrRenderer = (page: InertiaSerializedPage) => Promise<InertiaSsrRenderResult>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readManifest(manifestPath: string): Manifest | null {
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Manifest;
}

function renderManifestTags(
  manifestPath: string,
  clientEntry: string,
  assetsUrlPrefix: string
): string {
  const manifest = readManifest(manifestPath);

  if (!manifest) {
    return "";
  }

  const entry = manifest[clientEntry];
  if (!entry) {
    return "";
  }

  const tags: string[] = [];

  for (const cssFile of entry.css ?? []) {
    tags.push(`<link rel="stylesheet" href="${assetsUrlPrefix}/${cssFile}" />`);
  }

  if (entry.file) {
    tags.push(`<script type="module" src="${assetsUrlPrefix}/${entry.file}"></script>`);
  }

  return tags.join("\n");
}

function normalizeUrlPrefix(urlPrefix: string): string {
  if (!urlPrefix || urlPrefix === "/") {
    return "/";
  }

  return `/${urlPrefix.replace(/^\/+|\/+$/g, "")}/`;
}

function joinUrlPath(urlPrefix: string, assetPath: string): string {
  const normalizedPrefix = normalizeUrlPrefix(urlPrefix);
  const normalizedAssetPath = assetPath.replace(/^\/+/, "");

  if (normalizedPrefix === "/") {
    return `/${normalizedAssetPath}`;
  }

  return `${normalizedPrefix}${normalizedAssetPath}`;
}

function renderViteDevTags(clientEntry: string, assetsUrlPrefix: string): string {
  return [
    "<script type=\"module\">",
    `import RefreshRuntime from '${joinUrlPath(assetsUrlPrefix, "@react-refresh")}'`,
    "RefreshRuntime.injectIntoGlobalHook(window)",
    "window.$RefreshReg$ = () => {}",
    "window.$RefreshSig$ = () => (type) => type",
    "window.__vite_plugin_react_preamble_installed__ = true",
    "</script>",
    `<script type="module" src="${joinUrlPath(assetsUrlPrefix, "@vite/client")}"></script>`,
    `<script type="module" src="${joinUrlPath(assetsUrlPrefix, clientEntry)}"></script>`,
  ].join("\n");
}

function renderDocument(options: {
  title: string;
  lang: string;
  page: InertiaSerializedPage;
  appHtml: string;
  head?: string[];
  assetTags?: string;
  wrapApp?: boolean;
}): string {
  const pageJson = JSON.stringify(options.page).replace(/</g, "\\u003c");
  const extraHead = options.head?.join("\n") ?? "";
  const assetTags = options.assetTags ?? "";
  const hasTitle = /<title/i.test(extraHead);
  const fallbackTitle = hasTitle ? "" : `  <title>${escapeHtml(options.title)}</title>`;
  const appMarkup =
    options.wrapApp === false
      ? options.appHtml
      : `  <div id="app" data-page='${escapeHtml(pageJson)}'>${options.appHtml}</div>`;

  return [
    "<!DOCTYPE html>",
    `<html lang="${escapeHtml(options.lang)}">`,
    "<head>",
    '  <meta charSet="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    fallbackTitle,
    extraHead,
    assetTags,
    "</head>",
    "<body>",
    appMarkup,
    "</body>",
    "</html>",
  ]
    .filter(Boolean)
    .join("\n");
}

async function importSsrRenderer(ssrBuildPath: string): Promise<SsrRenderer> {
  const moduleUrl = pathToFileURL(ssrBuildPath).href;
  const loadedModule = (await import(moduleUrl)) as {
    default?: SsrRenderer;
    render?: SsrRenderer;
    renderPage?: SsrRenderer;
  };

  const renderer = loadedModule.renderPage ?? loadedModule.render ?? loadedModule.default;
  if (!renderer) {
    throw new Error(`SSR renderer not found in "${ssrBuildPath}"`);
  }

  return renderer;
}

async function resolveSsrRenderer(
  viteConfig: InertiaViteConfig,
  viteServer?: ViteDevServer
): Promise<SsrRenderer> {
  if (viteServer) {
    const loadedModule = (await viteServer.ssrLoadModule(viteConfig.ssrEntry)) as {
      default?: SsrRenderer;
      render?: SsrRenderer;
      renderPage?: SsrRenderer;
    };
    const renderer = loadedModule.renderPage ?? loadedModule.render ?? loadedModule.default;
    if (!renderer) {
      throw new Error(`SSR renderer not found in "${viteConfig.ssrEntry}"`);
    }
    return renderer;
  }

  return importSsrRenderer(viteConfig.ssrBuildPath);
}

async function renderVitePage(
  page: InertiaSerializedPage,
  title: string,
  lang: string,
  viteConfig: InertiaViteConfig,
  viteServer?: ViteDevServer
): Promise<string> {
  const renderer = await resolveSsrRenderer(viteConfig, viteServer);
  const result = await renderer(page);
  const assetsUrlPrefix = viteConfig.assetsUrlPrefix ?? "/frontend-assets";
  const assetTags =
    viteServer
      ? renderViteDevTags(
          viteConfig.devClientEntry ?? viteConfig.clientEntry,
          assetsUrlPrefix
        )
      : renderManifestTags(
          path.join(viteConfig.clientBuildDir, "manifest.json"),
          viteConfig.clientEntry,
          assetsUrlPrefix
        );

  return renderDocument({
    title,
    lang,
    page,
    appHtml: result.html,
    head: result.head,
    assetTags,
    wrapApp: false,
  });
}

class InertiaPageHandler {
  constructor(private readonly frontendApp: AppInertiajs) {}

  async process(appManager: AppManager, data: LocalCollectionItem[]): Promise<void> {
    for (const collectionItem of data) {
      const { route, component, props, title, status, lang } = collectionItem.item;

      appManager.app.get(route, async (req: Request, res: Response) => {
        // Props resolvers run inside the try as well: a failing database query is as much a render
        // error as a failing component, and must not reach the client as an unhandled rejection.
        try {
          const resolvedProps =
            typeof props === "function"
              ? await props(req, appManager)
              : (props ?? {});

          const pageTitle =
            typeof title === "function"
              ? title(resolvedProps)
              : (title ?? (typeof component === "string" ? component : component.name) ?? "SSR Page");

          const pageLang = lang ?? this.frontendApp.htmlLang;

          const page: InertiaSerializedPage = {
            component: typeof component === "string" ? component : component.name || "AnonymousPage",
            props: resolvedProps,
            url: req.originalUrl || req.url,
            version: this.frontendApp.inertiaVite?.version ?? "1",
          };

          const document =
            this.frontendApp.inertiaVite && typeof component === "string"
              ? await renderVitePage(
                  page,
                  pageTitle,
                  pageLang,
                  this.frontendApp.inertiaVite,
                  this.frontendApp.viteServer
                )
              : renderDocument({
                  title: pageTitle,
                  lang: pageLang,
                  page,
                  appHtml: renderToString(React.createElement(component, resolvedProps)),
                });

          res.status(status ?? 200).type("html").send(document);
        } catch (error) {
          // The stack goes to the log, never to the visitor: it names files, paths and sometimes
          // values from the failed query. Only the Vite dev server (VITE_ENV=dev) shows it inline.
          AppManager.log.error(
            `[${this.frontendApp.appId}] render of ${req.method} ${req.originalUrl || req.url} failed\n` +
              String(error instanceof Error ? error.stack : error)
          );
          if (res.headersSent) {
            return;
          }
          const detail =
            process.env.VITE_ENV === "dev"
              ? String(error instanceof Error ? error.stack : error)
              : "Internal Server Error";
          res.status(500).type("text").send(detail);
        }
      });
    }
  }

  async unprocess(appManager: AppManager, data: LocalCollectionItem[]): Promise<void> {
    for (const collectionItem of data) {
      const { route } = collectionItem.item;

      appManager.app._router.stack = appManager.app._router.stack.filter((layer: any) => {
        return !(layer.route && layer.route.path === route && layer.route.methods?.get);
      });
    }
  }
}

export abstract class AppInertiajs extends AbstractApp {
  inertiaVite?: InertiaViteConfig;
  /**
   * `<html lang>` of every page this app renders; a page definition's `lang` overrides it.
   * Defaults to "ru", which is what the attribute was hard-coded to before it was configurable.
   */
  htmlLang = "ru";
  viteServer?: ViteDevServer;
  private viteMiddlewareBound = false;

  @Collection
  inertiaPages: InertiaPageDefinition[] = [];

  @CollectionHandler("inertiaPages")
  inertiaPageHandler = new InertiaPageHandler(this);

  private isViteAssetRequest(url: string): boolean {
    const assetsUrlPrefix = normalizeUrlPrefix(this.inertiaVite?.assetsUrlPrefix ?? "/");
    const normalizedUrl =
      assetsUrlPrefix !== "/" && url.startsWith(assetsUrlPrefix)
        ? `/${url.slice(assetsUrlPrefix.length).replace(/^\/+/, "")}`
        : url;

    return (
      normalizedUrl.startsWith("/@vite") ||
      normalizedUrl.startsWith("/@id") ||
      normalizedUrl.startsWith("/src/") ||
      normalizedUrl.startsWith("/node_modules/") ||
      normalizedUrl.startsWith("/@react-refresh") ||
      normalizedUrl.startsWith("/@fs/")
    );
  }

  async setupViteDevServer(httpServer?: HttpServer): Promise<void> {
    if (!this.inertiaVite || process.env.VITE_ENV !== "dev") {
      return;
    }

    if (this.viteServer) {
      return;
    }

    const { createServer } = await import("vite");

    this.viteServer = await createServer({
      configFile: this.inertiaVite.configFile,
      root: this.inertiaVite.rootDir,
      server: {
        middlewareMode: true,
        hmr: httpServer ? { server: httpServer } : undefined,
      },
      appType: "custom",
    });

    if (!this.viteMiddlewareBound) {
      this.viteMiddlewareBound = true;
      this.appManager.app.use((req: Request, res: Response, next: NextFunction) => {
        if (this.isViteAssetRequest(req.url)) {
          this.viteServer?.middlewares(req, res, next);
          return;
        }

        next();
      });
    }
  }

  private setupProductionAssets(): void {
    if (!this.inertiaVite || process.env.VITE_ENV === "dev") {
      return;
    }

    const assetsUrlPrefix = this.inertiaVite.assetsUrlPrefix ?? "/frontend-assets";
    this.appManager.app.use(
      assetsUrlPrefix,
      serveStatic(this.inertiaVite.clientBuildDir, { index: false })
    );
  }

  async mount(): Promise<void> {
    if (process.env.VITE_ENV === "dev" && this.appManager.server) {
      await this.setupViteDevServer(this.appManager.server);
    }
    this.setupProductionAssets();
  }

  async unmount(): Promise<void> {
    await this.viteServer?.close();
    this.viteServer = undefined;
  }
}
