import { NextRequest, NextResponse } from "next/server";
import { getPreviewStatus } from "@/lib/previewManager";

export const runtime = "nodejs";

/**
 * Same-origin proxy for the preview dev server, used by Inspect mode.
 *
 * The preview app runs on another port (cross-origin), so the parent page
 * can't reach into its DOM. Serving the HTML through this proxy makes the
 * document same-origin and lets us inject a small element-picker script
 * that posts the clicked element's selector back to the workspace UI.
 * Static assets keep loading directly from the dev server via <base>.
 */

const PICKER_SCRIPT = `
<script id="__oc_inspect">
(function () {
  var last = null;

  function selectorFor(el) {
    if (el.id) return '#' + el.id;
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      var part = node.tagName.toLowerCase();
      var cls = (node.className && typeof node.className === 'string')
        ? node.className.trim().split(/\\s+/).slice(0, 2).join('.')
        : '';
      if (cls) part += '.' + cls;
      var parent = node.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(
          parent.children,
          function (c) { return c.tagName === node.tagName; }
        );
        if (same.length > 1) {
          part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
        }
      }
      parts.unshift(part);
      if (node.id) { parts[0] = '#' + node.id; break; }
      node = parent;
    }
    return parts.join(' > ');
  }

  document.addEventListener('mouseover', function (e) {
    if (last) last.style.outline = '';
    last = e.target;
    last.style.outline = '2px solid #6c8cff';
    last.style.outlineOffset = '1px';
  }, true);

  document.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    parent.postMessage({
      type: 'oc-element-picked',
      selector: selectorFor(el),
      tag: el.tagName.toLowerCase(),
      classes: (typeof el.className === 'string' ? el.className : ''),
      text: (el.innerText || '').trim().slice(0, 120),
    }, '*');
  }, true);
})();
</script>
`;

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId") || "default";
  const rawPath = req.nextUrl.searchParams.get("path") || "/";

  if (!rawPath.startsWith("/")) {
    return NextResponse.json({ error: "path must start with /" }, { status: 400 });
  }

  const preview = getPreviewStatus(projectId);
  if (preview.status !== "running" || !preview.url) {
    return new NextResponse(
      "<html><body style='font-family:sans-serif;color:#888;background:#111'>" +
        "<p style='padding:24px'>Preview server is not running — start it first, then enable Inspect.</p>" +
        "</body></html>",
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }

  try {
    const upstream = await fetch(`${preview.url}${rawPath}`, {
      headers: { Accept: req.headers.get("accept") ?? "*/*" },
    });

    const contentType = upstream.headers.get("content-type") ?? "text/html";

    if (/text\/html/i.test(contentType)) {
      let html = await upstream.text();
      // Assets resolve directly against the dev server; document stays same-origin
      const baseTag = `<base href="${preview.url}/">`;
      html = html.includes("<head>")
        ? html.replace("<head>", `<head>${baseTag}`)
        : baseTag + html;
      html = html.includes("</body>")
        ? html.replace("</body>", `${PICKER_SCRIPT}</body>`)
        : html + PICKER_SCRIPT;

      return new NextResponse(html, {
        status: upstream.status,
        headers: { "Content-Type": contentType },
      });
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    return new NextResponse(body, {
      status: upstream.status,
      headers: { "Content-Type": contentType },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
