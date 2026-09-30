// Wraps site/page.html (written as a body fragment) into a complete site/dist/index.html for
// GitHub Pages, and copies the assets next to it.
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const out = path.join(dir, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
const page = fs.readFileSync(path.join(dir, 'page.html'), 'utf8');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="assets/icon.png">
<style>html{-webkit-text-size-adjust:100%}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${page}
</body>
</html>
`;
fs.writeFileSync(path.join(out, 'index.html'), html);
for (const f of fs.readdirSync(path.join(dir, 'assets'))) fs.copyFileSync(path.join(dir, 'assets', f), path.join(out, 'assets', f));
console.log(`site built → ${path.relative(process.cwd(), out)}/index.html`);
