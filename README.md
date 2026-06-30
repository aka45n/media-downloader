codex/media-finder-downloader
# Media Finder Downloader

Chrome extension for finding hard-to-download PDF and image files from the current page without opening DevTools.

## Install locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select this folder: `/Users/akamatsunaoaki/Documents/downloader`.
5. Click the extension icon to open the persistent side panel.

## What it finds

- PDF files
- PNG, JPEG, GIF, WebP, AVIF, SVG, BMP, and TIFF images
- Links, images, source sets, embeds, objects, and CSS background images found in the page
- Matching network responses captured while the tab is loading
- Embedded `data:image/...` images, such as slides rendered as base64 PNG data
- Large visible canvas images
- Kyoto University BookRoll pages get an extra BookRoll-specific canvas candidate when the visible slide redraws without changing the URL
- Site decoration such as logos, favicons, app icons, and sprites is filtered out where possible

## How to use

1. Open a page that contains files you want to save.
2. Click the extension icon.
3. Use Scan page when you need to refresh the candidate list.
4. Click Download on one item, or select multiple rows and click Download selected.
5. Chrome asks where to save each file.

When a page moves to the next image without changing the URL, keep the side panel open and use the page's next arrow. The extension polls visible canvas content and places newly detected canvas images near the top of the candidate list.

On Kyoto University BookRoll pages such as `https://bookroll.let.media.kyoto-u.ac.jp/bookroll/vue/...`, the extension also adds a BookRoll-specific canvas candidate with a `bookroll-...` filename.

Use Collect all in the BookRoll PDF section to automatically move through BookRoll slides, collect each slide image, and download them as one PDF. PDF filenames use `bookroll`, a lesson title label, and the BookRoll lesson number from the URL when available.
Known BookRoll lesson IDs can be mapped to human lesson numbers; unknown BookRoll documents use `lesson` instead of leaking the internal document ID into filenames.
On BookRoll material list pages, links like `/bookroll/book/view?contents=...` are remembered so filenames can use labels such as `微分積分学A02`.

Use Download PDF only when you already have collected the slides you want.
Starting Collect all clears previously collected BookRoll slides for the current BookRoll document, so downloads from another lesson do not reuse old slides.

Some websites block direct downloads or require signed URLs. In those cases, open the page first while logged in, then scan and download from the same tab.

For login-required sites, use the same Chrome profile where you are already signed in. Downloads are started by Chrome with that session, and the extension also passes the current page as the `Referer` header when possible. If a direct download is still blocked, use Open on the candidate row to open the file URL in a logged-in tab.

## Current limits

- Blob URLs and files assembled by JavaScript are not downloaded yet.
- Files that require non-standard request headers or POST requests may still fail if the server blocks normal browser downloads.
- Network candidates are captured after the extension is installed and while the tab is active, so reload the page if an expected file is missing.
- BookRoll PDF generation uses `bookroll-canvas` slide captures. Use Collect all for automatic collection, or move through slides manually and then use Download PDF.
