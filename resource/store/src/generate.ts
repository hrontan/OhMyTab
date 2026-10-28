// Pure SVG illustrations/promos use only Node; settings slide alone loads capture.ts.
import fs from 'node:fs';
import path from 'node:path';
import { writePromos } from './promo-svg.ts';
import { screenshotSVG } from './screenshot-svg.ts';
import type { ScreenshotCopy } from './screenshot-svg.ts';
import { array, record, string } from '../../../scripts/runtime-boundaries.ts';
const here = import.meta.dirname;
const root = path.resolve(here, '../../..');
const out = path.resolve(process.env['STORE_OUTPUT_DIR'] ?? path.join(here, '../images'));
const requested = process.env['STORE_IMAGES']?.split(',').map(name => name.trim()).filter(Boolean);
const selected = requested ? new Set(requested) : undefined;
const wants = (name: string) => !selected || selected.has(name);
const locales = ['en', 'ja', 'zh_CN'];
const names = locales.flatMap(lang => [
  ...['small', 'marquee'].map(kind => 'promo-' + kind + '-' + lang + '.svg'),
  ...[1,2,3,4].map(index => 'screenshot-' + lang + '-' + index + '.svg'),
]);
for (const name of selected ?? []) if (!names.includes(name)) throw Error('Unknown SVG output: ' + name);
const input = record(JSON.parse(fs.readFileSync(path.join(here, 'copy.json'), 'utf8')) as unknown);
for (const name of writePromos(out, selected)) console.log(name);
for (const lang of locales) {
  const row = record(input[lang]);
  const copy: ScreenshotCopy = {
    font: string(row['font']), before: string(row['before']), after: string(row['after']),
    window: string(row['window']), duplicate: string(row['duplicate']),
    optionsCaption: string(row['optionsCaption']), illustration: string(row['illustration']),
    groupNote: string(row['groupNote']), duplicateNote: string(row['duplicateNote']),
    slides: array(row['slides']).map(value => { const slide = record(value);
      return {title: string(slide['title']), body: string(slide['body'])}; }),
  };
  if (![1,2,3,4].some(i => wants('screenshot-' + lang + '-' + i + '.svg'))) continue;
  const source = record(JSON.parse(fs.readFileSync(path.join(root, 'public/_locales/' + lang + '/messages.json'), 'utf8')) as unknown);
  const messages = Object.fromEntries(Object.entries(source).map(([key, value]) => [key, { message: string(record(value)['message']) }]));
  for (let index = 0; index < 4; index++) {
    const name = 'screenshot-' + lang + '-' + (index + 1) + '.svg';
    if (!wants(name)) continue;
    const capture = index === 3 ? await (await import('./capture.ts')).optionsScreenshot(lang) : undefined;
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, name), screenshotSVG(lang, index, copy, messages, capture));
    console.log(name);
  }
}
