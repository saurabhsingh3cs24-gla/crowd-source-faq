#!/usr/bin/env python3
"""Inject preview-only banner into the Pages-deployed Vite SPA index.html.

Called from .github/workflows/deploy-pages.yml after `pnpm build` rewrites
the /csfaq/ paths. Adds a top-fixed dismissable banner so visitors to
vicharanashala.github.io/crowd-source-faq/ know this is a UI-only preview
and can click through to the real app at samagama.in/csfaq.
"""
import os
import re
import sys

HTML_PATH = 'apps/frontend/dist/index.html'

BANNER_HTML = '''
<div id="gh-pages-banner" style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#ff6b35;color:#fff;padding:10px 16px;font-family:-apple-system,system-ui,sans-serif;font-size:14px;text-align:center;line-height:1.4;box-shadow:0 2px 8px rgba(0,0,0,0.2);">
  <strong>&#9888; Frontend-only preview</strong> &mdash; this GitHub Pages deploy serves the UI shell; the backend API is reachable but limited. For the full app visit
  <a href="https://samagama.in/csfaq" style="color:#fff;text-decoration:underline;font-weight:600;">samagama.in/csfaq &rarr;</a>
  &nbsp;|&nbsp; <a href="javascript:void(0)" id="gh-pages-dismiss" style="color:#fff;text-decoration:underline;font-weight:600;">dismiss</a>
</div>
<style>body{padding-top:56px}#gh-pages-dismiss:hover{color:#ffe4d6}</style>
<script>
(function(){
  try {
    if (localStorage.getItem('gh-pages-banner-dismissed') === '1') {
      var b = document.getElementById('gh-pages-banner');
      if (b) b.remove();
      return;
    }
    document.addEventListener('DOMContentLoaded', function(){
      var d = document.getElementById('gh-pages-dismiss');
      if (d) d.addEventListener('click', function(){
        var b = document.getElementById('gh-pages-banner');
        if (b) b.remove();
        try { localStorage.setItem('gh-pages-banner-dismissed', '1'); } catch (e) {}
      });
    });
  } catch (e) {}
})();
</script>'''


def main() -> int:
    if not os.path.exists(HTML_PATH):
        print(f'No index.html at {HTML_PATH}, skipping banner')
        return 0
    with open(HTML_PATH) as f:
        html = f.read()
    new = re.sub(r'(<body[^>]*>)', r'\1' + BANNER_HTML, html, count=1)
    with open(HTML_PATH, 'w') as f:
        f.write(new)
    print('Preview-only banner injected')
    return 0


if __name__ == '__main__':
    sys.exit(main())