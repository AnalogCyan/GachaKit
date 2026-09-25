// The GachaKit build engine, bound to a project root so a site can import it

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";

// A problem with the site's own source, reported without a stack trace
export class BuildError extends Error {}

export function createEngine({ root: rootDir = process.cwd() } = {}) {
  const root = path.resolve(rootDir);
  const SRC_DIR = path.join(root, "src");
  const CAPSULES_DIR = path.join(SRC_DIR, "capsules");
  const PAGES_DIR = path.join(SRC_DIR, "pages");
  const STYLES_DIR = path.join(SRC_DIR, "styles");
  const SCRIPTS_DIR = path.join(SRC_DIR, "scripts");
  const DATA_DIR = path.join(SRC_DIR, "data");
  const IMAGES_DIR = path.join(SRC_DIR, "images");
  const STATIC_DIR = path.join(SRC_DIR, "static");
  const CONFIG_PATH = path.join(SRC_DIR, "config.json");
  const PUBLIC_DIR = path.join(root, "public");

  // Defaults the starter site relies on; both are config-overridable
  const DEFAULT_STANDALONE_SCRIPTS = ["theme-init.js"];
  const DEFAULT_STYLE_ORDER = [
    "variables.css",
    "reset.css",
    "base.css",
    "home.css",
  ];

  // Marks a {{key}} that had no matching data attribute
  const UNSET = "\u0000unset\u0000";
  // Where a capsule's {{slot}} goes, filled after its placeholders
  const SLOT = "\u0000slot\u0000";

  // The capsule whose build hook is in flight, so a caller can name one that
  // never settles
  let runningHook = null;
  // public/ paths written by build hooks, mapped to the capsule that wrote them
  const hookOutputs = new Map();

  function warnIfHookOutput(destPath) {
    const owner = hookOutputs.get(destPath);
    if (!owner) return;
    const relPath = path
      .relative(PUBLIC_DIR, destPath)
      .split(path.sep)
      .join("/");
    console.warn(
      `⚠️ public/${relPath} from capsule "${owner}" build hook is overwritten by the build.`
    );
  }

  // For values that are already HTML, like a page's own title: quotes and angle
  // brackets only, so existing entities are not encoded twice. Both quote
  // characters, since a capsule may be written with either.
  function escapeAttribute(str) {
    return String(str)
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeHTML(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // What each config.json key must hold. "*" is any key of a map, a one-item
  // array is a list of that shape, and keys not named here are not checked.
  const CONFIG_SHAPE = {
    fonts: { "*": { name: "string", url: "string" } },
    externalResources: {
      "*": { type: "string", url: "string", defer: "boolean" },
    },
    meta: {
      title: "string",
      description: "string",
      author: "string",
      image: "string",
      siteUrl: "string",
      cleanUrls: "boolean",
    },
    indieweb: {
      relMe: ["string"],
      webmention: "string",
      pingback: "string",
      feed: "string",
      feeds: [{ href: "string", type: "string", title: "string" }],
    },
    styles: { order: ["string"] },
    scripts: { standalone: ["string"] },
    capsules: {},
  };

  function describeType(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "a list";
    if (typeof value === "object") return "an object";
    return `a ${typeof value}`;
  }

  function checkConfigShape(value, shape, key) {
    const expected = Array.isArray(shape)
      ? "a list"
      : typeof shape === "object"
        ? "an object"
        : `a ${shape}`;
    if (describeType(value) !== expected) {
      const where = key ? `src/config.json: ${key}` : "src/config.json";
      throw new BuildError(
        `${where} must be ${expected}, not ${describeType(value)}.`
      );
    }

    if (Array.isArray(shape)) {
      value.forEach((item, i) =>
        checkConfigShape(item, shape[0], `${key}[${i}]`)
      );
    } else if (typeof shape === "object") {
      for (const [name, item] of Object.entries(value)) {
        const inner = Object.hasOwn(shape, name) ? shape[name] : shape["*"];
        if (inner === undefined) continue;
        checkConfigShape(item, inner, key ? `${key}.${name}` : name);
      }
    }
  }

  // Source text without the byte order mark some editors write
  async function readText(filePath) {
    return (await fs.readFile(filePath, "utf-8")).replace(/^\uFEFF/, "");
  }

  async function loadConfig() {
    let configData;
    try {
      configData = await readText(CONFIG_PATH);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      console.warn("⚠️ No src/config.json found. Using defaults.");
      return {
        fonts: {},
        externalResources: {},
        meta: { title: "GachaKit" },
      };
    }

    let config;
    try {
      config = JSON.parse(configData);
    } catch (err) {
      throw new BuildError(
        `src/config.json is not valid JSON: ${err.message}`,
        { cause: err }
      );
    }
    checkConfigShape(config, CONFIG_SHAPE, "");
    return config;
  }

  // Generate HTML for external resources from config, one tag per line
  function generateResourcesHTML(config) {
    const fonts = Object.values(config.fonts || {}).filter((font) => font.url);
    const externals = Object.entries(config.externalResources || {}).filter(
      ([, resource]) => resource.url
    );
    const lines = [];

    // One preconnect per origin rather than per resource. Relative URLs
    // need none.
    const preconnected = new Set();
    const preconnect = (url, crossorigin) => {
      let origin;
      try {
        // Protocol-relative URLs load over https on an https site
        origin = new URL(String(url).startsWith("//") ? `https:${url}` : url)
          .origin;
      } catch {
        return;
      }
      if (origin === "null" || preconnected.has(origin)) return;
      preconnected.add(origin);
      lines.push(
        `<link rel="preconnect" href="${escapeHTML(origin)}"${crossorigin ? " crossorigin" : ""} />`
      );
    };

    if (fonts.length > 0) {
      for (const font of fonts) {
        preconnect(font.url, false);
        // Google's stylesheet loads the font files from a second origin
        if (preconnected.has("https://fonts.googleapis.com")) {
          preconnect("https://fonts.gstatic.com", true);
        }
      }
      for (const font of fonts) {
        lines.push(
          `<!-- Font - ${escapeHTML(String(font.name))} -->`,
          `<link href="${escapeHTML(font.url)}" rel="stylesheet" />`
        );
      }
    }

    if (externals.length > 0) {
      for (const [, resource] of externals) {
        if (resource.type === "stylesheet" || resource.type === "script") {
          preconnect(resource.url, true);
        }
      }
      for (const [key, resource] of externals) {
        if (resource.type === "stylesheet") {
          lines.push(
            `<!-- External: ${escapeHTML(key)} -->`,
            `<link href="${escapeHTML(resource.url)}" rel="stylesheet" />`
          );
        } else if (resource.type === "script") {
          lines.push(
            `<!-- External: ${escapeHTML(key)} -->`,
            `<script src="${escapeHTML(resource.url)}"${resource.defer ? " defer" : ""}></script>`
          );
        } else {
          console.warn(
            `⚠️ externalResources.${key} has type ${JSON.stringify(resource.type)}; use "stylesheet" or "script". Skipped.`
          );
        }
      }
    }
    return lines.join("\n");
  }

  async function pathExists(p) {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  // macOS Finder and AppleDouble metadata, never site content
  const METADATA_FILE = /^(\._|\.DS_Store$)/;

  function sourcePath(fullPath) {
    return path.relative(root, fullPath).split(path.sep).join("/");
  }

  // A directory's entries as "file" or "dir", symlinks followed. Metadata
  // files, dangling links and anything else are left out.
  async function listEntries(dir, quiet = false) {
    const listed = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (METADATA_FILE.test(entry.name)) continue;
      let stat = entry;
      if (entry.isSymbolicLink()) {
        try {
          stat = await fs.stat(path.join(dir, entry.name));
        } catch (err) {
          if (err.code !== "ENOENT" && err.code !== "ELOOP") throw err;
          if (quiet) continue;
          console.warn(
            `⚠️ Skipped ${sourcePath(path.join(dir, entry.name))}: the symlink is broken.`
          );
          continue;
        }
      }
      if (stat.isDirectory()) listed.push({ name: entry.name, kind: "dir" });
      else if (stat.isFile()) listed.push({ name: entry.name, kind: "file" });
    }
    return listed;
  }

  // Every file under dir as a "/" path relative to it, in sorted order
  async function walkFiles(dir, { quiet = false, ancestors = [] } = {}) {
    const real = await fs.realpath(dir);
    if (ancestors.includes(real)) {
      if (quiet) return [];
      console.warn(
        `⚠️ Skipped ${sourcePath(dir)}: the symlink loops back into its own tree.`
      );
      return [];
    }
    const files = [];
    for (const { name, kind } of await listEntries(dir, quiet)) {
      if (kind === "file") {
        files.push(name);
        continue;
      }
      const nested = await walkFiles(path.join(dir, name), {
        quiet,
        ancestors: [...ancestors, real],
      });
      files.push(...nested.map((file) => `${name}/${file}`));
    }
    return files.sort();
  }

  // Load all capsules and gather their file paths/content
  async function loadCapsules() {
    if (!(await pathExists(CAPSULES_DIR))) {
      console.warn("⚠️ No src/capsules directory found. Skipping capsules.");
      return {};
    }
    const capsules = {};

    for (const entry of await listEntries(CAPSULES_DIR)) {
      if (entry.kind !== "dir") continue;
      const name = entry.name;
      const base = path.join(CAPSULES_DIR, name);
      const capsule = { name };
      const files = (await listEntries(base))
        .filter((file) => file.kind === "file")
        .map((file) => file.name);

      // Matched against the listing, not the filesystem, so a case-insensitive
      // disk finds exactly the files a case-sensitive one does
      const find = (fileName) => {
        if (files.includes(fileName)) return path.join(base, fileName);
        const near = files.find(
          (file) => file.toLowerCase() === fileName.toLowerCase()
        );
        if (near) {
          console.warn(
            `⚠️ Skipped src/capsules/${name}/${near}: capsule files are case-sensitive, expected ${fileName}.`
          );
          if (fileName === `${name}.html`) capsule.htmlCaseMatch = near;
        }
        return null;
      };

      const htmlPath = find(`${name}.html`);
      if (htmlPath) capsule.html = await readText(htmlPath);

      const cssPath = find(`${name}.css`);
      if (cssPath) capsule.cssPath = cssPath;

      const jsPath = find(`${name}.js`);
      if (jsPath) capsule.jsPath = jsPath;

      const buildPath = find("build.js");
      if (buildPath) capsule.buildPath = buildPath;

      capsules[name] = capsule;
    }

    return capsules;
  }

  // Enough of the HTML tokenizer to tell markup from text: comments, tags
  // (a quote only opens a string at the start of an attribute value, as in
  // HTML), and the bodies of script, style, title and textarea, where a "<"
  // is text. Tags named in `protect` get their body skipped too, but only
  // when it is closed. Linear, and anything unterminated runs to the end.
  const TEXT_BODIES = new Set(["script", "style", "title", "textarea"]);
  const isSpace = (c) =>
    c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";

  function readTag(html, start, nameStart) {
    const n = html.length;
    let i = nameStart;
    while (i < n && !isSpace(html[i]) && html[i] !== "/" && html[i] !== ">") {
      i += 1;
    }
    const tag = { name: html.slice(nameStart, i).toLowerCase(), start };
    tag.attrsStart = i;
    while (i < n) {
      const c = html[i];
      if (c === ">") return { ...tag, attrsEnd: i, end: i + 1 };
      if (isSpace(c) || c === "/") {
        i += 1;
        continue;
      }
      i += 1;
      while (i < n && !isSpace(html[i]) && !"/>=".includes(html[i])) {
        i += 1;
      }
      let j = i;
      while (j < n && isSpace(html[j])) j += 1;
      if (html[j] !== "=") {
        i = j;
        continue;
      }
      j += 1;
      while (j < n && isSpace(html[j])) j += 1;
      if (html[j] === '"' || html[j] === "'") {
        const close = html.indexOf(html[j], j + 1);
        if (close === -1) break;
        i = close + 1;
      } else {
        while (j < n && !isSpace(html[j]) && html[j] !== ">") j += 1;
        i = j;
      }
    }
    return { ...tag, attrsEnd: n, end: n, unterminated: true };
  }

  const endTagPatterns = new Map();
  function findEndTag(html, name, from) {
    if (!endTagPatterns.has(name)) {
      endTagPatterns.set(name, new RegExp(`</${name}(?=[\\s/>])`, "gi"));
    }
    const pattern = endTagPatterns.get(name);
    pattern.lastIndex = from;
    return pattern.exec(html)?.index ?? -1;
  }

  function* htmlTokens(html, protect) {
    const n = html.length;
    let i = 0;
    while (i < n) {
      const lt = html.indexOf("<", i);
      if (lt === -1) return;
      if (html.startsWith("<!--", lt)) {
        const close = html.indexOf("-->", lt + 4);
        const end = close === -1 ? n : close + 3;
        yield { type: "comment", start: lt, end };
        i = end;
        continue;
      }
      if (html[lt + 1] === "!" || html[lt + 1] === "?") {
        const close = html.indexOf(">", lt + 2);
        const end = close === -1 ? n : close + 1;
        yield { type: "declaration", start: lt, end };
        i = end;
        continue;
      }
      const closing = html[lt + 1] === "/";
      const nameStart = lt + (closing ? 2 : 1);
      if (!/[a-zA-Z]/.test(html[nameStart] ?? "")) {
        i = lt + 1;
        continue;
      }
      const tag = readTag(html, lt, nameStart);
      yield { type: closing ? "endtag" : "starttag", ...tag };
      i = tag.end;
      if (closing || tag.unterminated) continue;
      const text = TEXT_BODIES.has(tag.name);
      if (text || protect?.has(tag.name)) {
        const close = findEndTag(html, tag.name, i);
        if (close !== -1 || text) {
          const end = close === -1 ? n : close;
          yield { type: "body", name: tag.name, start: i, end };
          i = end;
        }
      }
    }
  }

  function parseAttributes(source) {
    const attrs = {};
    const pattern =
      /([^\t\n\f\r "'=<>/]+)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r >]*)))?/g;
    for (const [, name, double, single, bare] of source.matchAll(pattern)) {
      attrs[name.toLowerCase()] = double ?? single ?? bare ?? "";
    }
    return attrs;
  }

  // The <title>, <meta> and <link> tags of the head, with their offsets in
  // the page. A title also has the offsets of its text.
  function headTags(html) {
    const tags = [];
    for (const token of htmlTokens(html)) {
      if (token.type === "endtag" && token.name === "head") break;
      if (token.type === "starttag" && token.name === "body") break;
      if (token.type === "body" && token.name === "title") {
        const title = tags.at(-1);
        if (title?.name === "title" && title.textStart === undefined) {
          title.textStart = token.start;
          title.textEnd = token.end;
        }
        continue;
      }
      if (
        token.type !== "starttag" ||
        token.unterminated ||
        !["title", "meta", "link"].includes(token.name)
      ) {
        continue;
      }
      tags.push({
        name: token.name,
        start: token.start,
        end: token.end,
        attrs: parseAttributes(html.slice(token.attrsStart, token.attrsEnd)),
      });
    }
    return tags;
  }

  // Adds tags just before </head>, each on its own line one level in from it.
  // Pages without one keep their markup and say so.
  function appendToHead(html, tags, pageName) {
    if (tags.length === 0) return html;
    let at = -1;
    for (const token of htmlTokens(html)) {
      if (token.type === "endtag" && token.name === "head") {
        at = token.start;
        break;
      }
    }
    if (at === -1) {
      console.warn(
        `⚠️ No </head> on page ${pageName}. Skipped ${tags.length} head tag(s).`
      );
      return html;
    }
    const lineStart = html.lastIndexOf("\n", at - 1) + 1;
    const ownLine = /^[ \t]*$/.test(html.slice(lineStart, at));
    const indent = ownLine ? html.slice(lineStart, at) : "";
    const lines = tags.map((tag) => `${indent}  ${tag}\n`).join("");
    return ownLine
      ? html.slice(0, lineStart) + lines + html.slice(lineStart)
      : `${html.slice(0, at)}\n${lines}${html.slice(at)}`;
  }

  // Fills a <meta name> the page lacks or left empty. The page's own wins.
  function fillMeta(html, name, value, pageName) {
    const tag = `<meta name="${name}" content="${escapeHTML(value)}" />`;
    const existing = headTags(html).find(
      (t) => t.name === "meta" && t.attrs.name?.toLowerCase() === name
    );
    if (!existing) return appendToHead(html, [tag], pageName);
    if (existing.attrs.content?.trim()) return html;
    return html.slice(0, existing.start) + tag + html.slice(existing.end);
  }

  function injectResources(content, resourcesHTML, config, pageName) {
    // the resources take the placeholder's indent, and an empty set leaves
    // no trailing whitespace behind
    let output = content.replace(
      /(^[ \t]*)?<!-- EXTERNAL_RESOURCES -->/m,
      (_, indent = "") =>
        resourcesHTML && indent + resourcesHTML.split("\n").join(`\n${indent}`)
    );
    const meta = config.meta || {};

    // a page's own title, description and author win, config only fills a
    // missing or empty one
    if (meta.title) {
      const title = headTags(output).find((t) => t.name === "title");
      if (!title) {
        output = appendToHead(
          output,
          [`<title>${escapeHTML(meta.title)}</title>`],
          pageName
        );
      } else if (!output.slice(title.textStart, title.textEnd).trim()) {
        output =
          output.slice(0, title.textStart) +
          escapeHTML(meta.title) +
          output.slice(title.textEnd);
      }
    }
    if (meta.description) {
      output = fillMeta(output, "description", meta.description, pageName);
    }
    if (meta.author) {
      output = fillMeta(output, "author", meta.author, pageName);
    }

    output = injectSocialTags(output, config, pageName);
    output = injectIndieWebTags(output, config, pageName);

    return output;
  }

  // URL path a built page is served at. cleanUrls drops the .html extension
  // for hosts that serve about.html at /about
  function pagePath(pageName, config) {
    const name = pageName.split(path.sep).join("/");
    const url = (p) => `/${p.split("/").map(encodeURIComponent).join("/")}`;
    if (name === "index.html") return "/";
    // a nested index is the directory's own page
    if (name.endsWith("/index.html")) {
      return url(name.slice(0, -"index.html".length));
    }
    if (config.meta?.cleanUrls) return url(name.replace(/\.html$/i, ""));
    return url(name);
  }

  // Open Graph and Twitter tags from config.meta, skipped if the page has its own
  function injectSocialTags(html, config, pageName) {
    const meta = config.meta || {};
    const existing = headTags(html);
    const hasOg = existing.some(
      (t) => t.name === "meta" && /^og:/i.test(t.attrs.property ?? "")
    );
    if (!meta.title || hasOg) return html;

    const siteUrl = String(meta.siteUrl || "").replace(/\/+$/, "");
    // the page's resolved title, so every page does not share one social title
    const pageTitle = existing.find((t) => t.name === "title");
    const title = pageTitle
      ? escapeAttribute(
          html.slice(pageTitle.textStart, pageTitle.textEnd).trim()
        )
      : escapeHTML(meta.title);
    const tags = [
      `<meta property="og:title" content="${title}" />`,
      `<meta property="og:type" content="website" />`,
    ];
    const pageDescription = existing.find(
      (t) =>
        t.name === "meta" &&
        t.attrs.name?.toLowerCase() === "description" &&
        t.attrs.content?.trim()
    );
    const description = pageDescription
      ? escapeAttribute(pageDescription.attrs.content.trim())
      : meta.description && escapeHTML(meta.description);
    if (description) {
      tags.push(`<meta property="og:description" content="${description}" />`);
    }
    if (meta.image) {
      // absolute where possible, since some scrapers will not resolve a relative one
      const image =
        siteUrl && !/^(https?:)?\/\//i.test(String(meta.image))
          ? `${siteUrl}/${String(meta.image).replace(/^\.?\//, "")}`
          : meta.image;
      tags.push(`<meta property="og:image" content="${escapeHTML(image)}" />`);
      tags.push(`<meta name="twitter:card" content="summary_large_image" />`);
    }
    // a 404 is served at whatever path was missing, so it has no URL of its own
    if (siteUrl && pageName !== "404.html") {
      tags.push(
        `<meta property="og:url" content="${escapeHTML(siteUrl + pagePath(pageName, config))}" />`
      );
    }

    return appendToHead(html, tags, pageName);
  }

  // IndieWeb discovery links: identity, webmention endpoint, feeds, canonical.
  // All of it comes from config, so the framework is not tied to one provider.
  function injectIndieWebTags(html, config, pageName) {
    const indieweb = config.indieweb || {};
    const meta = config.meta || {};
    const siteUrl = String(meta.siteUrl || "").replace(/\/+$/, "");
    const tags = [];

    const absolute = (href) => {
      const value = String(href || "");
      if (!siteUrl || /^(https?:)?\/\//i.test(value)) return value;
      return `${siteUrl}/${value.replace(/^\.?\//, "")}`;
    };

    // error pages get no canonical, they are not a destination
    const isErrorPage = pageName === "404.html";
    const hasCanonical = headTags(html).some(
      (t) =>
        t.name === "link" &&
        (t.attrs.rel ?? "").toLowerCase().split(/\s+/).includes("canonical")
    );
    if (siteUrl && !isErrorPage && !hasCanonical) {
      tags.push(
        `<link rel="canonical" href="${escapeHTML(siteUrl + pagePath(pageName, config))}" />`
      );
    }

    for (const feed of indieweb.feeds || []) {
      if (!feed || !feed.href) continue;
      const type = feed.type ? ` type="${escapeHTML(feed.type)}"` : "";
      const title = feed.title ? ` title="${escapeHTML(feed.title)}"` : "";
      tags.push(
        `<link rel="alternate"${type}${title} href="${escapeHTML(absolute(feed.href))}" />`
      );
    }

    // the human readable h-feed, distinct from the rel=alternate machine feeds
    if (indieweb.feed) {
      tags.push(
        `<link rel="feed" href="${escapeHTML(absolute(indieweb.feed))}" />`
      );
    }

    if (indieweb.webmention) {
      tags.push(
        `<link rel="webmention" href="${escapeHTML(indieweb.webmention)}" />`
      );
    }
    if (indieweb.pingback) {
      tags.push(
        `<link rel="pingback" href="${escapeHTML(indieweb.pingback)}" />`
      );
    }

    for (const profile of indieweb.relMe || []) {
      if (!profile) continue;
      tags.push(`<link rel="me" href="${escapeHTML(profile)}" />`);
    }

    return appendToHead(html, tags, pageName);
  }

  // Regions whose contents are text, not markup to expand: comments,
  // declarations, script and style bodies, closed pre and code bodies, and
  // any tag other than a drop that holds markup in an attribute value. In
  // page order, so they can be binary searched.
  const PROTECTED = new Set(["pre", "code"]);
  function findProtectedRegions(content) {
    const regions = [];
    for (const token of htmlTokens(content, PROTECTED)) {
      const { type, name, start, end } = token;
      if (type === "comment" || type === "declaration") {
        regions.push([start, end]);
      } else if (type === "body") {
        if (name !== "title" && name !== "textarea") regions.push([start, end]);
      } else if (
        name !== "drop" &&
        content.slice(start + 1, end).includes("<")
      ) {
        regions.push([start, end]);
      }
    }
    return regions;
  }

  function regionAt(regions, at) {
    let low = 0;
    let high = regions.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (at < regions[mid][0]) high = mid - 1;
      else if (at >= regions[mid][1]) low = mid + 1;
      else return regions[mid];
    }
    return null;
  }

  // Next match of a global pattern outside any protected region, or null
  function findOutside(pattern, content, from, regions) {
    pattern.lastIndex = from;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const region = regionAt(regions, match.index);
      if (!region) return match;
      pattern.lastIndex = region[1];
    }
    return null;
  }

  // <drop but not <dropdown. Closing tags tolerate case and whitespace, both
  // of which HTML allows
  const DROP_START = /<drop(?=[\s/>])/gi;
  const DROP_CLOSE = /<\/drop\s*>/gi;
  const DROP_TAG = /<drop(?=[\s/>])|<\/drop\s*>/gi;

  // Reads a <drop> tag from its "<" with HTML's attribute rules, so a ">"
  // inside a quoted value does not end the tag early. A "/" just before the
  // ">" makes it self-closing, quoted value or not.
  function readDropTag(content, at) {
    const tag = readTag(content, at, at + 1);
    if (tag.unterminated) return null;
    const attrs = content.slice(tag.attrsStart, tag.attrsEnd);
    const trimmed = attrs.trimEnd();
    const selfClosing = trimmed.endsWith("/");
    return {
      attrs: selfClosing ? trimmed.slice(0, -1) : attrs,
      end: tag.end,
      selfClosing,
    };
  }

  // Index of the </drop> closing the tag that ends at `from`, counting nested
  // drops so slot content can hold capsules of its own
  function findDropClose(content, from, regions) {
    let depth = 1;
    let i = from;

    for (;;) {
      const match = findOutside(DROP_TAG, content, i, regions);
      if (!match) return -1;

      if (match[0][1] === "/") {
        depth -= 1;
        const end = match.index + match[0].length;
        if (depth === 0) return { start: match.index, end };
        i = end;
        continue;
      }
      const tag = readDropTag(content, match.index);
      if (!tag) return -1;
      if (!tag.selfClosing) depth += 1;
      i = tag.end;
    }
  }

  // The capsule name and data-* values of a drop, quoted or not, as HTML
  // reads them. An attribute with no value is empty.
  function parseDropAttributes(attrs) {
    let capsule;
    const data = Object.create(null);
    const attrRegex =
      /([^\t\n\f\r "'>/=]+)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r >]+)))?/g;
    let match;
    while ((match = attrRegex.exec(attrs)) !== null) {
      const [, name, double, single, bare] = match;
      const value = double ?? single ?? bare ?? "";
      const lower = name.toLowerCase();
      if (lower === "capsule") capsule ??= value;
      else if (lower.startsWith("data-")) data[lower.slice(5)] = value;
    }
    return { capsule: capsule ?? "", data };
  }

  // Index of the next drop tag outside any protected region, or -1
  function findNextDrop(content, from, regions) {
    return findOutside(DROP_START, content, from, regions)?.index ?? -1;
  }

  // One attribute with the whitespace before it, read as HTML does, and
  // what to step over when no attribute starts at a position. HTML
  // whitespace is narrower than \s, which also takes U+00A0 and the like.
  const ATTRIBUTE =
    /[\t\n\f\r ]*[^\t\n\f\r />][^\t\n\f\r />=]*(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r >]+)))?/y;
  const NOT_ATTRIBUTE = /[\t\n\f\r ]+|[^]/y;

  // Walks the attributes in order, so text inside another attribute's
  // value is never mistaken for one
  function dropUnsetAttributes(attrs) {
    let out = "";
    let i = 0;
    while (i < attrs.length) {
      ATTRIBUTE.lastIndex = i;
      const match = ATTRIBUTE.exec(attrs);
      if (match) {
        const value = match[1] ?? match[2] ?? match[3];
        i = ATTRIBUTE.lastIndex;
        if (value === UNSET) continue;
        // HTML reads <img src={{u}}/> as a value ending in "/", but the
        // author meant a self-closing tag, so keep the slash
        if (match[3] === UNSET + "/" && i === attrs.length) {
          out += /^[\t\n\f\r ]*/.exec(match[0])[0] + "/";
        } else {
          out += match[0];
        }
      } else {
        NOT_ATTRIBUTE.lastIndex = i;
        out += NOT_ATTRIBUTE.exec(attrs)[0];
        i = NOT_ATTRIBUTE.lastIndex;
      }
    }
    return out;
  }

  // Drops each attribute whose whole value is an unset placeholder. Only
  // start tags have attributes; anywhere else, including script and style
  // bodies and comments, the placeholder only empties.
  function stripUnset(html) {
    let result = "";
    let last = 0;
    for (const token of htmlTokens(html)) {
      if (token.type !== "starttag") continue;
      result +=
        html.slice(last, token.attrsStart) +
        dropUnsetAttributes(html.slice(token.attrsStart, token.attrsEnd));
      last = token.attrsEnd;
    }
    return (result + html.slice(last)).split(UNSET).join("");
  }

  // Why a drop missed a capsule that exists in another letter case
  function caseHint(capsules, name) {
    const capsule = capsules[name];
    if (capsule?.htmlCaseMatch) {
      return `. Rename src/capsules/${name}/${capsule.htmlCaseMatch} to ${name}.html, capsule names are case-sensitive.`;
    }
    const other = Object.keys(capsules).find(
      (key) => key.toLowerCase() === name.toLowerCase()
    );
    return other && !capsule
      ? `. Did you mean "${other}"? Capsule names are case-sensitive.`
      : "";
  }

  /**
   * Single-pass expansion: replaces one layer of <drop>…</drop>
   * Returns { html, used } where used is a Set of capsule names referenced in this pass.
   */
  function injectCapsules(content, capsules, pageName) {
    const used = new Set();
    const regions = findProtectedRegions(content);
    let result = "";
    let i = 0;

    while (i < content.length) {
      const open = findNextDrop(content, i, regions);
      if (open === -1) break;

      const tag = readDropTag(content, open);
      if (!tag) {
        throw new BuildError(`Unterminated <drop> tag on page ${pageName}`);
      }

      let slotContent = "";
      let dropEnd = tag.end;
      if (!tag.selfClosing) {
        const close = findDropClose(content, tag.end, regions);
        if (close === -1) {
          throw new BuildError(`Unclosed <drop> tag on page ${pageName}`);
        }
        slotContent = content.slice(tag.end, close.start);
        dropEnd = close.end;
      }

      const { capsule: capsuleName, data: dataAttrs } = parseDropAttributes(
        tag.attrs
      );
      const capsule = capsules[capsuleName];
      if (
        Object.hasOwn(capsules, capsuleName) &&
        capsule.html === undefined &&
        !capsule.htmlCaseMatch
      ) {
        throw new BuildError(
          `src/capsules/${capsuleName}/ has no ${capsuleName}.html, needed on page ${pageName}`
        );
      }
      if (!capsule || capsule.html === undefined) {
        throw new BuildError(
          `Capsule "${capsuleName}" not found on page ${pageName}${caseHint(capsules, capsuleName)}`
        );
      }

      used.add(capsuleName);

      // Placeholders are filled in one pass over the capsule's own markup, so
      // a {{…}} inside the slot or a data value is left alone. Values come out
      // of the source HTML already encoded, so only the characters that would
      // break an attribute are escaped. A placeholder with no value is marked
      // so its attribute can be dropped rather than emitted empty. A drop with
      // no children clears the slot rather than printing it.
      const capsuleHtml = stripUnset(
        capsule.html.replace(/{{\s*([a-zA-Z0-9_-]+)\s*}}/g, (_, key) => {
          // Attribute names are case-insensitive, so the lookup is too
          const name = key.toLowerCase();
          if (name === "slot") return SLOT;
          return name in dataAttrs
            ? escapeAttribute(String(dataAttrs[name]))
            : UNSET;
        })
      )
        .split(SLOT)
        .join(slotContent);

      result += content.slice(i, open) + capsuleHtml;
      i = dropEnd;
    }

    result += content.slice(i);
    return { html: result, used };
  }

  /**
   * Recursive expansion wrapper: runs injectCapsules until no drop tags remain.
   * Each pass unwraps one level of nesting, so the pass cap doubles as a
   * nesting cap, and runaway output is caught by size rather than by count.
   */
  async function expandAllDrops(inputHtml, capsules, pageName, globalUsed) {
    const MAX_PASSES = 25;
    const MAX_OUTPUT = 32 * 1024 * 1024;
    let html = inputHtml;

    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const regions = findProtectedRegions(html);
      if (findNextDrop(html, 0, regions) === -1) {
        if (findOutside(DROP_CLOSE, html, 0, regions)) {
          throw new BuildError(
            `Stray </drop> with no opening <drop> on page ${pageName}`
          );
        }
        return html;
      }

      const { html: nextHtml, used } = injectCapsules(html, capsules, pageName);
      // Accumulate used capsules globally for script bundling
      used.forEach((u) => globalUsed.add(u));

      if (nextHtml.length > MAX_OUTPUT) {
        throw new BuildError(
          `Expanding ${pageName} passed ${MAX_OUTPUT} bytes. A capsule that drops itself more than once doubles the page every pass.`
        );
      }
      // A capsule that expands to its own drop tag would loop forever
      if (nextHtml === html) {
        throw new BuildError(
          `Expanding ${pageName} made no progress. Check for a capsule that drops itself.`
        );
      }

      html = nextHtml;
    }

    throw new BuildError(
      `Expanding ${pageName} hit ${MAX_PASSES} passes. Check for circular capsule references, or nesting deeper than ${MAX_PASSES - 1} levels.`
    );
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Appends the build hash to the bundle links, however they are written.
  // Standalone scripts are named, since they sit outside the bundle.
  function bustAssetPaths(html, hash, standalone = DEFAULT_STANDALONE_SCRIPTS) {
    if (!hash) return html;
    let output = html
      .replace(
        /(href=)(["'])((?:\.?\/)?)styles\.css\2/g,
        `$1$2$3styles.css?v=${hash}$2`
      )
      .replace(
        /(src=)(["'])((?:\.?\/)?)scripts\.js\2/g,
        `$1$2$3scripts.js?v=${hash}$2`
      );

    for (const name of standalone) {
      const pattern = new RegExp(
        `(src=)(["'])((?:\\.?/)?scripts/${escapeRegExp(name)})\\2`,
        "g"
      );
      output = output.replace(pattern, `$1$2$3?v=${hash}$2`);
    }

    return output;
  }

  // Every .html under src/pages, including nested directories
  async function collectPages() {
    return (await walkFiles(PAGES_DIR)).filter((file) => /\.html$/i.test(file));
  }

  // Expands every page in memory, keyed in sorted order so hooks see the same
  // pages object every build even though pages render in parallel
  async function renderPages(capsules, config, globalUsed) {
    if (!(await pathExists(PAGES_DIR))) {
      throw new BuildError(
        `No src/pages directory in ${root}. GachaKit needs one page to build.`
      );
    }
    const files = (await collectPages()).sort();
    const resourcesHTML = generateResourcesHTML(config);

    const rendered = await Promise.all(
      files.map(async (file) => {
        try {
          const srcPath = path.join(PAGES_DIR, ...file.split("/"));
          const content = await readText(srcPath);

          // Expand drops first, so a page whose <head> comes from a capsule
          // still gets the meta, social and IndieWeb tags
          const expanded = await expandAllDrops(
            content,
            capsules,
            file,
            globalUsed
          );

          const withResources = injectResources(
            expanded,
            resourcesHTML,
            config,
            file
          );
          const contentWithAssets = bustAssetPaths(
            withResources,
            config.buildHash,
            config?.scripts?.standalone || DEFAULT_STANDALONE_SCRIPTS
          );
          return [file, contentWithAssets];
        } catch (err) {
          console.error(`❌ Failed building page ${file}: ${err.message}`);
          throw err;
        }
      })
    );

    return Object.fromEntries(rendered);
  }

  async function writePages(pagesMap) {
    for (const [file, html] of Object.entries(pagesMap)) {
      const destPath = path.join(PUBLIC_DIR, ...file.split("/"));
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, html);
      console.log(`✅ Built: ${file}`);
    }
  }

  async function buildPages(capsules, config, globalUsed) {
    const pagesMap = await renderPages(capsules, config, globalUsed);
    await fs.mkdir(PUBLIC_DIR, { recursive: true });
    await writePages(pagesMap);
    return { pagesMap };
  }

  // For a double-quoted CSS string: quotes and backslashes escaped, newlines
  // as hex escapes since a string cannot hold them raw
  function cssString(str) {
    return String(str).replace(/["\\\n\r\f]/g, (c) =>
      c === '"' || c === "\\" ? `\\${c}` : `\\${c.charCodeAt(0).toString(16)} `
    );
  }

  // Update CSS variables from config if needed
  // Applies the configured font to the design tokens. Returns the CSS rather
  // than writing it, since styles.css is the only stylesheet pages load.
  async function renderVariablesCSS(config) {
    const variablesCssPath = path.join(STYLES_DIR, "variables.css");
    if (!(await pathExists(variablesCssPath))) {
      console.warn("⚠️ No src/styles/variables.css found. Skipping tokens.");
      return "";
    }

    try {
      let cssContent = await readText(variablesCssPath);

      if (config.fonts?.primary?.name) {
        cssContent = cssContent.replace(
          /--font-base:[\s\S]*?;/,
          () =>
            `--font-base: "${cssString(config.fonts.primary.name)}", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;`
        );
      }

      return cssContent;
    } catch (err) {
      console.error(`❌ Could not read CSS variables: ${err.message}`);
      throw err;
    }
  }

  async function bundleStyles(capsules, usedCapsules, variablesCss, config) {
    const files = (await pathExists(STYLES_DIR))
      ? (await walkFiles(STYLES_DIR)).filter((f) => f.endsWith(".css"))
      : [];
    const configured = config?.styles?.order;
    const ordered = [...new Set(configured || DEFAULT_STYLE_ORDER)];
    if (configured) {
      for (const f of ordered.filter((f) => !files.includes(f))) {
        console.warn(`⚠️ styles.order lists ${f}, which is not in src/styles.`);
      }
    }
    const cssFiles = [
      ...ordered.filter((f) => files.includes(f)),
      ...files.filter((f) => !ordered.includes(f)),
    ];
    let output = "";

    // Global styles
    for (const file of cssFiles) {
      const css =
        file === "variables.css"
          ? variablesCss
          : await readText(path.join(STYLES_DIR, ...file.split("/")));
      output += `\n/* === ${file} === */\n` + css;
    }

    // Capsule styles (only those actually used). Sorted because pages build in
    // parallel, so the set's insertion order varies between runs.
    for (const capName of [...usedCapsules].sort()) {
      const cap = capsules[capName];
      if (cap && cap.cssPath) {
        const css = await readText(cap.cssPath);
        output += `\n/* === Capsule: ${capName} === */\n` + css;
      }
    }

    const stylesPath = path.join(PUBLIC_DIR, "styles.css");
    warnIfHookOutput(stylesPath);
    await fs.writeFile(stylesPath, output);
    console.log("🎨 styles.css generated.");
  }

  async function bundleScripts(usedCapsules, capsules, config) {
    const standaloneScripts = new Set(
      config?.scripts?.standalone || DEFAULT_STANDALONE_SCRIPTS
    );
    let files = [];
    if (await pathExists(SCRIPTS_DIR)) {
      files = (await walkFiles(SCRIPTS_DIR)).filter((f) => f.endsWith(".js"));
    } else {
      console.warn(
        "⚠️ No scripts directory found. Bundling capsule scripts only."
      );
    }
    let output = "";
    const standalone = [];

    // Global scripts
    for (const file of files) {
      if (standaloneScripts.has(file)) {
        standalone.push(file);
        continue;
      }
      const js = await readText(path.join(SCRIPTS_DIR, ...file.split("/")));
      // The semicolon keeps a file without a final one from running into the
      // next file's opening parenthesis
      output += `\n// === ${file} ===\n${js}\n;`;
    }

    const standaloneDir = path.join(PUBLIC_DIR, "scripts");
    await Promise.all(
      standalone.map(async (file) => {
        const destPath = path.join(standaloneDir, ...file.split("/"));
        warnIfHookOutput(destPath);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(path.join(SCRIPTS_DIR, ...file.split("/")), destPath);
      })
    );

    // Capsule scripts, only those actually used; nested ones count via expandAllDrops
    // Each is wrapped so two capsules declaring the same top-level name cannot
    // collide and take the whole bundle down with a redeclaration error.
    for (const capName of [...usedCapsules].sort()) {
      const cap = capsules[capName];
      if (cap && cap.jsPath) {
        const js = await readText(cap.jsPath);
        output += `\n// === Capsule: ${capName} ===\n;(() => {\n${js}\n})();\n`;
      }
    }

    const scriptsPath = path.join(PUBLIC_DIR, "scripts.js");
    warnIfHookOutput(scriptsPath);
    await fs.writeFile(scriptsPath, output);
    console.log("⚙️ scripts.js generated.");
  }

  async function copyDataFiles() {
    if (!(await pathExists(DATA_DIR))) return;
    const publicDataDir = path.join(PUBLIC_DIR, "data");

    try {
      await fs.mkdir(publicDataDir, { recursive: true });

      for (const file of await walkFiles(DATA_DIR)) {
        const srcPath = path.join(DATA_DIR, ...file.split("/"));
        const destPath = path.join(publicDataDir, ...file.split("/"));
        warnIfHookOutput(destPath);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(srcPath, destPath);
        console.log(`📄 Copied data file: ${file}`);
      }
    } catch (err) {
      console.error(`❌ Error copying data files: ${err.message}`);
      throw err;
    }
  }

  // Clears stale output so removed pages and assets do not linger. Empties
  // public/ rather than removing it, so a symlinked public/ stays a symlink.
  async function cleanPublic() {
    if (await pathExists(PUBLIC_DIR)) {
      for (const name of await fs.readdir(PUBLIC_DIR)) {
        await fs.rm(path.join(PUBLIC_DIR, name), {
          recursive: true,
          force: true,
        });
      }
    }
    await fs.mkdir(PUBLIC_DIR, { recursive: true });
  }

  async function copyStaticFiles() {
    if (!(await pathExists(STATIC_DIR))) return;

    for (const file of await walkFiles(STATIC_DIR)) {
      const srcPath = path.join(STATIC_DIR, ...file.split("/"));
      const destPath = path.join(PUBLIC_DIR, ...file.split("/"));
      if (await pathExists(destPath)) {
        console.warn(
          `⚠️ src/static/${file} overwrites a file the build generated.`
        );
      }
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(srcPath, destPath);
      console.log(`📦 Copied static file: ${file}`);
    }
  }

  async function copyImageFiles() {
    if (!(await pathExists(IMAGES_DIR))) return;
    const publicImagesDir = path.join(PUBLIC_DIR, "images");

    try {
      await fs.mkdir(publicImagesDir, { recursive: true });

      for (const file of await walkFiles(IMAGES_DIR)) {
        const srcPath = path.join(IMAGES_DIR, ...file.split("/"));
        const destPath = path.join(publicImagesDir, ...file.split("/"));
        warnIfHookOutput(destPath);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(srcPath, destPath);
        console.log(`🖼️ Copied image file: ${file}`);
      }
    } catch (err) {
      console.error(`❌ Error copying image files: ${err.message}`);
      throw err;
    }
  }

  // Hooks run for every capsule that has one, used by a page or not, in name
  // order so two hooks writing the same file do it the same way every build.
  async function runCapsuleBuildScripts(capsules, pagesMap, config) {
    const entries = Object.entries(capsules).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    hookOutputs.clear();

    for (const [name, cap] of entries) {
      if (!cap.buildPath) continue;
      runningHook = name;
      try {
        const mod = await import(pathToFileURL(cap.buildPath).href);
        if (typeof mod.build !== "function") {
          console.warn(
            `⚠️ Capsule "${name}" build.js skipped: a named export "build" is required.`
          );
          continue;
        }

        const writeOutput = async (relPath, content) => {
          const outPath = path.resolve(PUBLIC_DIR, relPath);
          const inside = path.relative(PUBLIC_DIR, outPath);
          if (
            !inside ||
            inside === ".." ||
            inside.startsWith(`..${path.sep}`) ||
            path.isAbsolute(inside)
          ) {
            throw new BuildError(
              `writeOutput("${relPath}") resolves outside public/`
            );
          }
          await fs.mkdir(path.dirname(outPath), { recursive: true });
          await fs.writeFile(outPath, content);
          hookOutputs.set(outPath, name);
        };

        await mod.build({
          capsuleName: name,
          capsuleConfig: config?.capsules?.[name] || {},
          pages: pagesMap,
          writeOutput,
        });
        console.log(`🛠️ Capsule build executed: ${name}`);
      } catch (err) {
        // a hook's own bug keeps its stack, a refused writeOutput does not
        const Failure = err instanceof BuildError ? BuildError : Error;
        throw new Failure(
          `Build script for capsule "${name}" failed: ${err.message}`,
          { cause: err }
        );
      } finally {
        runningHook = null;
      }
    }
  }

  async function build() {
    const config = await loadConfig();
    config.buildHash = await generateHash();
    const capsules = await loadCapsules();

    const usedCapsules = new Set();

    const variablesCss = await renderVariablesCSS(config);

    // Pages expand before public/ is cleared, so a source error leaves the
    // last good build in place (accumulates usedCapsules)
    const pagesMap = await renderPages(capsules, config, usedCapsules);
    await cleanPublic();
    await writePages(pagesMap);

    // Run optional per-capsule build hooks
    await runCapsuleBuildScripts(capsules, pagesMap, config);

    // Bundle assets
    await bundleStyles(capsules, usedCapsules, variablesCss, config);
    await bundleScripts(usedCapsules, capsules, config);
    await copyDataFiles();
    await copyImageFiles();
    await writeSitemap(config, Object.keys(pagesMap));
    await copyStaticFiles();

    console.log("🚀 GachaKit build complete!");
  }

  // Lists built pages for crawlers. Needs an absolute site URL to be valid
  async function writeSitemap(config, pages) {
    const siteUrl = String(config.meta?.siteUrl || "").replace(/\/+$/, "");
    if (!siteUrl) {
      console.warn("⚠️ No meta.siteUrl in config.json. Skipping sitemap.xml.");
      return;
    }

    const urls = pages
      .filter((file) => file !== "404.html")
      .map((file) => pagePath(file, config))
      .sort()
      .map((p) => `  <url><loc>${escapeHTML(siteUrl + p)}</loc></url>`)
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
    const sitemapPath = path.join(PUBLIC_DIR, "sitemap.xml");
    warnIfHookOutput(sitemapPath);
    await fs.writeFile(sitemapPath, xml);
    console.log("🗺️ sitemap.xml generated.");
  }

  // Hashes every source the bundles are built from, config included, so the
  // query string changes when and only when the output does
  async function generateHash() {
    const sources = [
      [STYLES_DIR, /\.css$/],
      [SCRIPTS_DIR, /\.js$/],
      [CAPSULES_DIR, /\.(css|js|html)$/],
    ];
    const files = [];

    for (const [dir, pattern] of sources) {
      if (!(await pathExists(dir))) continue;
      // quiet, since the bundles walk the same trees and warn then
      for (const file of await walkFiles(dir, { quiet: true })) {
        if (pattern.test(file)) files.push(path.join(dir, ...file.split("/")));
      }
    }
    if (await pathExists(CONFIG_PATH)) files.push(CONFIG_PATH);

    // "/" separators, so Windows and macOS hash the same site the same way
    const named = files
      .map((file) => [sourcePath(file), file])
      .sort(([a], [b]) => (a < b ? -1 : 1));
    const hash = crypto.createHash("sha1");
    for (const [name, file] of named) {
      hash.update(name);
      hash.update(await fs.readFile(file));
    }
    return hash.digest("hex").slice(0, 8);
  }

  return {
    build,
    get runningHook() {
      return runningHook;
    },
    cleanPublic,
    loadConfig,
    loadCapsules,
    generateResourcesHTML,
    buildPages,
    expandAllDrops,
    injectCapsules,
    bustAssetPaths,
    injectResources,
    injectSocialTags,
    injectIndieWebTags,
    renderVariablesCSS,
    bundleStyles,
    bundleScripts,
    copyDataFiles,
    copyImageFiles,
    copyStaticFiles,
    runCapsuleBuildScripts,
    writeSitemap,
    generateHash,
    escapeHTML,
    paths: {
      root,
      src: SRC_DIR,
      capsules: CAPSULES_DIR,
      pages: PAGES_DIR,
      styles: STYLES_DIR,
      scripts: SCRIPTS_DIR,
      data: DATA_DIR,
      images: IMAGES_DIR,
      static: STATIC_DIR,
      config: CONFIG_PATH,
      public: PUBLIC_DIR,
    },
  };
}
