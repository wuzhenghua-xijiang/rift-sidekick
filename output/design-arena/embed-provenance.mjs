import { readFile, writeFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile(new URL('assets/sources.json', import.meta.url), 'utf8'));
for (const [name, source] of Object.entries(manifest.sources)) {
  if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
  await writeFile(new URL(`assets/${name}.json`, import.meta.url), JSON.stringify({
    prompt: `Sourced image, not generated. Origin: ${source.origin}. Owner: ${source.owner}. Use: ${source.use}.`,
    origin: source.origin,
    attribution: source.owner,
  }, null, 2));
}
console.log('Asset origins recorded from the download manifest.');
