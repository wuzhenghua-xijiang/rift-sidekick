import { mkdir, writeFile, readFile, copyFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(new URL('../../package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const lucide = require('lucide-react');
const root = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(root, 'assets');
await mkdir(target, { recursive: true });
const headers = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  Referer: 'https://www.leagueoflegends.com/',
};
const sources = {};
async function download(name, url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status}: ${name}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFile(path.join(target, name), bytes);
  sources[name] = { origin: url, bytes: bytes.length, owner: 'Riot Games / Data Dragon', use: 'local design concept' };
}
const versions = await fetch('https://ddragon.leagueoflegends.com/api/versions.json', { headers: { ...headers, Accept: 'application/json' } }).then(r => r.json());
const patch = versions[0];
const champs = ['Yasuo', 'Jinx', 'Camille', 'Irelia', 'Zed', 'Ahri', 'LeeSin', 'Lux', 'Thresh', 'Ashe', 'Sylas', 'Ekko', 'Vayne', 'Jhin', 'Aatrox'];
const splash = ['Yasuo', 'Jinx', 'Camille', 'Irelia', 'Zed'];
const tasks = [
  ...splash.map(c => [`${c}-splash.jpg`, `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${c}_0.jpg`]),
  ...champs.map(c => [`${c}.png`, `https://ddragon.leagueoflegends.com/cdn/${patch}/img/champion/${c}.png`]),
  ...[3031, 3006, 3046, 3036, 3072, 3153, 3078, 3047, 3053, 6333, 3026, 3094, 3087, 3157, 3118, 3089].map(id => [`item-${id}.png`, `https://ddragon.leagueoflegends.com/cdn/${patch}/img/item/${id}.png`]),
  ...['SummonerFlash', 'SummonerDot', 'SummonerTeleport'].map(c => [`${c}.png`, `https://ddragon.leagueoflegends.com/cdn/${patch}/img/spell/${c}.png`]),
  ['rift-map.png', `https://ddragon.leagueoflegends.com/cdn/${patch}/img/map/map11.png`],
  ['conqueror.png', 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/Precision/Conqueror/Conqueror.png'],
  ['lethal-tempo.png', 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/Precision/LethalTempo/LethalTempoTemp.png'],
];
const failures = [];
for (let start = 0; start < tasks.length; start += 5) {
  const group = tasks.slice(start, start + 5);
  const results = await Promise.allSettled(group.map(([name, url]) => download(name, url)));
  results.forEach((result, i) => { if (result.status === 'rejected') failures.push({ file: group[i][0], error: String(result.reason) }); });
}
for (const [family, weights] of [['barlow-condensed', ['600', '700', '800', '900']], ['dm-mono', ['400', '500']]]) {
  const dir = path.join(root, '../../node_modules/@fontsource', family, 'files');
  const names = await readdir(dir);
  for (const weight of weights) {
    const name = names.find(n => n === `${family}-latin-${weight}-normal.woff2`);
    if (name) await copyFile(path.join(dir, name), path.join(target, name));
  }
}
const css = await fetch('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Archivo+Black&display=swap', { headers: { ...headers, Accept: 'text/css' } }).then(r => r.text());
const latinBlocks = css.match(/\/\* latin \*\/[\s\S]*?(?=\/\*|$)/g) || [];
for (const block of latinBlocks) {
  const family = block.match(/font-family: '([^']+)'/)?.[1];
  const url = block.match(/url\(([^)]+)\)/)?.[1];
  if (!family || !url) continue;
  const name = family === 'Cinzel' ? 'cinzel.woff2' : 'archivo-black.woff2';
  await download(name, url);
  sources[name].owner = 'Google Fonts / Open Font License';
}
const iconNames = ['Swords', 'LayoutDashboard', 'Trophy', 'BookOpen', 'Crosshair', 'Bot', 'AudioLines', 'Settings2', 'ArrowRight', 'ChevronRight', 'ChevronDown', 'Check', 'Plus', 'X', 'Minus', 'Maximize2', 'CircleHelp', 'UserRound', 'LockKeyhole', 'Cpu', 'FolderOpen', 'RefreshCw', 'Play', 'Zap', 'ShieldCheck', 'Search', 'Target', 'History', 'Sparkles', 'Gamepad2', 'Radio', 'Volume2', 'CircleCheck', 'PanelLeftClose', 'ExternalLink', 'ArrowUpRight', 'LogOut', 'Flag', 'Copy', 'Eye', 'Undo2', 'Save', 'Circle', 'CheckCheck'];
const icons = Object.fromEntries(iconNames.map(name => [name, renderToStaticMarkup(React.createElement(lucide[name], { width: 20, height: 20, strokeWidth: 1.7, 'aria-hidden': true }))]));
await writeFile(path.join(target, 'icons.js'), `window.ICONS=${JSON.stringify(icons)};\n`);
await writeFile(path.join(target, 'sources.json'), JSON.stringify({ patch, sources, failures }, null, 2));
console.log(JSON.stringify({ patch, files: Object.keys(sources).length, failures }));
