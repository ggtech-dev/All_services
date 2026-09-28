// Finds a related Creative Commons photo for every category/service keyword via the Openverse API
// and caches it in images.json (committed), so db:setup never needs the network.
// Only missing keywords are fetched; delete an entry from images.json to re-fetch it.
import { readFile, writeFile } from 'node:fs/promises';
import { categories } from './catalog.js';

const CACHE = new URL('./images.json', import.meta.url);
const DELAY_MS = 3500; // Openverse anonymous rate limit is ~20 requests/minute

const cache = JSON.parse(await readFile(CACHE, 'utf8').catch(() => '{}'));
const keywords = [...new Set(categories.flatMap((c) => [c.image, ...c.services.map((s) => s[1])]))];
const missing = keywords.filter((k) => !cache[k]);
console.log(`${keywords.length} keywords, ${missing.length} to fetch`);

// Flickr "_b" (1024px) → "_z" (640px) keeps cards light.
const smaller = (url) => url.replace(/_b\.jpg$/, '_z.jpg');

for (const [i, kw] of missing.entries()) {
  const q = encodeURIComponent(kw.replace(/,/g, ' '));
  const res = await fetch(`https://api.openverse.org/v1/images/?q=${q}&page_size=10&extension=jpg&mature=false`);
  if (res.status === 429) {
    console.log('Rate limited — saving progress; run again in a few minutes.');
    break;
  }
  const data = await res.json();
  const pick = (data.results || []).find((r) => r.width >= 400 && r.height >= 250 && r.width >= r.height);
  if (pick) {
    cache[kw] = { url: smaller(pick.url), credit: pick.attribution, source: pick.foreign_landing_url };
    console.log(`✓ ${kw}`);
  } else {
    console.log(`✗ ${kw} (no match — card will show the emoji fallback)`);
  }
  await writeFile(CACHE, JSON.stringify(cache, null, 2));
  if (i < missing.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
}
