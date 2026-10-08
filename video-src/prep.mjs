// timeline.json → comp/timeline.js；main.js 里用到的 lucide 图标 → comp/icons.js
import fs from 'fs';
fs.writeFileSync('comp/timeline.js', 'window.TLD = ' + fs.readFileSync('timeline.json', 'utf8') + ';\n');
const dir = 'node_modules/lucide-static/icons/', src = fs.readFileSync('comp/main.js', 'utf8');
const names = [...new Set([...src.matchAll(/'([a-z0-9]+(?:-[a-z0-9]+)*)'/g)].map(m => m[1]))].filter(n => fs.existsSync(dir + n + '.svg'));
const icons = Object.fromEntries(names.map(n => [n, fs.readFileSync(dir + n + '.svg', 'utf8').replace(/<!--.*?-->\s*/s, '').replace(/\s+/g, ' ').trim()]));
fs.writeFileSync('comp/icons.js', 'window.ICONS = ' + JSON.stringify(icons) + ';\n');
console.log('icons', names.length);
