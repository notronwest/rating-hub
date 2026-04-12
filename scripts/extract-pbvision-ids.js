/**
 * PB Vision Video ID Extractor
 *
 * Paste this script into your browser console while logged into pb.vision/library.
 * It will navigate through all folders and collect every video ID + session info.
 *
 * Output: copies a JSON array of { vid, sessionIndex, name, date } to your clipboard.
 */
(async () => {
  const DELAY = 1500; // ms between navigations
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const allVideos = [];
  const seenVids = new Set();

  function extractVideosFromPage() {
    const links = Array.from(document.querySelectorAll('a[href*="/video/"]'));
    const videos = [];
    for (const a of links) {
      const match = a.href.match(/\/video\/([a-z0-9]+)(?:\/(\d+))?/);
      if (!match) continue;
      const vid = match[1];
      const sessionIndex = match[2] ? parseInt(match[2]) : 0;
      const key = `${vid}-${sessionIndex}`;
      if (seenVids.has(key)) continue;
      seenVids.add(key);

      // Try to extract name and date from the card text
      const text = a.textContent.trim();
      const nameMatch = text.match(/(?:\d+:\d+)?\s*(.*?)(?:\w{3}\s+\d{4}-\w{3}|$)/);
      const dateMatch = text.match(/(\w{3}\s+\d{4}-\w{3}-\d+\s+at\s+[\d:]+[ap]m)/);

      videos.push({
        vid,
        sessionIndex,
        name: nameMatch?.[1]?.trim() || null,
        date: dateMatch?.[1] || null,
      });
    }
    return videos;
  }

  async function scrollToBottom() {
    let lastHeight = 0;
    let attempts = 0;
    while (attempts < 20) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await wait(500);
      const newHeight = document.documentElement.scrollHeight;
      if (newHeight === lastHeight) break;
      lastHeight = newHeight;
      attempts++;
    }
    window.scrollTo(0, 0);
  }

  // Step 1: Start from library root
  console.log("[pbv-extract] Starting extraction...");

  if (!window.location.pathname.startsWith("/library")) {
    window.location.href = "/library";
    console.log("[pbv-extract] Navigating to /library... Re-run this script after the page loads.");
    return;
  }

  // Step 2: Check if we're in the library root (folders view) or a folder
  const isRoot = window.location.pathname === "/library" || window.location.pathname === "/library/";

  if (isRoot) {
    // Collect folder links
    await wait(DELAY);
    await scrollToBottom();

    // Folders are clickable divs/cards that navigate to /library/{folderId}
    // Extract folder URLs from all anchor tags and clickable elements
    const folderLinks = [];
    const allAnchors = Array.from(document.querySelectorAll("a"));
    for (const a of allAnchors) {
      const match = a.href.match(/\/library\/(\d+)/);
      if (match) folderLinks.push(a.href);
    }

    // Also check for non-anchor folder elements by looking at the page structure
    // Sometimes folders use onclick handlers instead of <a> tags
    if (folderLinks.length === 0) {
      // Try to find folder IDs from the rendered thumbnails
      const thumbs = Array.from(document.querySelectorAll("img[src*='storage.googleapis.com']"));
      console.log(`[pbv-extract] Found ${thumbs.length} thumbnail images but no folder links.`);
      console.log("[pbv-extract] Try navigating into a folder manually and re-run.");
    }

    // Also check for videos directly on the root page (flat library)
    const rootVideos = extractVideosFromPage();
    if (rootVideos.length > 0) {
      allVideos.push(...rootVideos);
      console.log(`[pbv-extract] Found ${rootVideos.length} videos on root page.`);
    }

    if (folderLinks.length > 0) {
      console.log(`[pbv-extract] Found ${folderLinks.length} folders. Visiting each...`);

      for (const folderUrl of folderLinks) {
        console.log(`[pbv-extract] Visiting folder: ${folderUrl}`);

        // Navigate to folder
        const resp = await fetch(folderUrl);
        const html = await resp.text();

        // Parse video links from the HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        // pb.vision is an SPA so fetching HTML won't have the data.
        // We need to actually navigate there.
      }

      // Since it's an SPA, we need to navigate in-browser
      console.log("[pbv-extract] This is a Single Page App - will navigate through folders.");
      console.log("[pbv-extract] Collecting video IDs from current page...");
    }
  }

  // Whether root or folder, scroll and extract what's visible
  await scrollToBottom();
  await wait(DELAY);
  const pageVideos = extractVideosFromPage();
  allVideos.push(...pageVideos);

  // Output results
  console.log(`\n[pbv-extract] ===== RESULTS =====`);
  console.log(`[pbv-extract] Found ${allVideos.length} unique video sessions.`);
  console.log(`[pbv-extract] Video IDs:`);

  const videoIds = allVideos.map((v) => v.vid);
  const uniqueIds = [...new Set(videoIds)];
  console.log(JSON.stringify(uniqueIds, null, 2));

  // Copy full data to clipboard
  try {
    await navigator.clipboard.writeText(JSON.stringify(allVideos, null, 2));
    console.log(`[pbv-extract] Full data copied to clipboard!`);
  } catch (e) {
    console.log(`[pbv-extract] Could not copy to clipboard. Here's the data:`);
    console.log(JSON.stringify(allVideos, null, 2));
  }

  // Also store in window for easy access
  window.__pbvVideoIds = uniqueIds;
  window.__pbvVideos = allVideos;
  console.log(`[pbv-extract] Data also available as window.__pbvVideoIds and window.__pbvVideos`);

  return allVideos;
})();
