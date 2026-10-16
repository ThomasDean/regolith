// Turns dist-single/index.html into a page body for a hosted claude.ai artifact
// (the host adds its own doctype, head and body). Usage: node scripts/make-artifact.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist-single/index.html', 'utf8');
const head = html.match(/<head>([\s\S]*)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
const title = head.match(/<title>[\s\S]*?<\/title>/)[0];
const fonts = [...head.matchAll(/<link[^>]+fonts\.googleapis\.com\/css2[^>]*>/g)].map((m) => m[0]);
const styles = [...head.matchAll(/<style[\s\S]*?<\/style>/g)].map((m) => m[0]);
const scripts = [...head.matchAll(/<script[\s\S]*?<\/script>/g)].map((m) => m[0]);
const out = [title, '<meta name="robots" content="noindex">', ...fonts, ...styles, body.trim(), ...scripts].join('\n');
writeFileSync('dist-single/artifact.html', out);
console.log(`dist-single/artifact.html ${(out.length / 1024).toFixed(0)} KB`);
