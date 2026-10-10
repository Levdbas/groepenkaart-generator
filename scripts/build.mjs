import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { transform } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

const vendorFiles = [
   'node_modules/fflate/umd/index.js',
   'node_modules/qrcode-generator/dist/qrcode.js',
   'node_modules/jspdf/dist/jspdf.umd.min.js',
   // Must come after jsPDF: it attaches autoTable to window.jspdf on load.
   'node_modules/jspdf-autotable/dist/jspdf.plugin.autotable.min.js',
];
const appFiles = ['src/js/warnings.js', 'src/js/rcd.js', 'src/js/schema.js', 'src/js/share.js', 'src/js/pdf.js', 'src/js/app.js'];

const read = (file) => readFile(join(root, file), 'utf8');
const hash = (content) => createHash('sha256').update(content).digest('hex').slice(0, 8);

async function emit(name, ext, content) {
   const file = `${name}.${hash(content)}.${ext}`;
   await writeFile(join(dist, file), content);
   return file;
}

async function build() {
   const started = Date.now();
   await rm(dist, { recursive: true, force: true });
   await mkdir(dist, { recursive: true });
   await cp(join(root, 'public'), dist, { recursive: true });

   const vendor = (await Promise.all(vendorFiles.map(read)))
      .map((code) => code.replace(/^\/\/# sourceMappingURL=.*$/gm, ''))
      .join('\n;\n');

   const app = await transform((await Promise.all(appFiles.map(read))).join('\n'), {
      loader: 'js',
      minify: true,
      target: 'es2019',
   });

   const css = await transform(await read('src/css/style.css'), {
      loader: 'css',
      minify: true,
   });

   const assets = {
      'vendor.js': await emit('vendor', 'js', vendor),
      'app.js': await emit('app', 'js', app.code),
      'app.css': await emit('app', 'css', css.code),
   };

   const html = (await read('src/index.html')).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
      if (!assets[key]) throw new Error(`Onbekende placeholder in index.html: ${match}`);
      return assets[key];
   });
   await writeFile(join(dist, 'index.html'), html);

   console.log(`Build klaar in ${Date.now() - started} ms:`, Object.values(assets).join(', '));
}

const types = {
   '.html': 'text/html; charset=utf-8',
   '.js': 'text/javascript; charset=utf-8',
   '.css': 'text/css; charset=utf-8',
   '.svg': 'image/svg+xml',
   '.png': 'image/png',
   '.ico': 'image/x-icon',
   '.json': 'application/json',
};

function serve(port = Number(process.env.PORT) || 8000) {
   createServer(async (req, res) => {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = normalize(join(dist, path.endsWith('/') ? path + 'index.html' : path));
      if (!file.startsWith(dist + sep)) {
         res.writeHead(403).end();
         return;
      }
      try {
         const body = await readFile(file);
         res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
         res.end(body);
      } catch {
         res.writeHead(404).end('Niet gevonden');
      }
   }).listen(port, () => console.log(`Dev server: http://localhost:${port}`));
}

await build();
if (process.argv.includes('--serve')) serve();
