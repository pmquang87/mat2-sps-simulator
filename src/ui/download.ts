/**
 * Browser file download via Blob + anchor click. Lives alone so panels can take a
 * `download(filename, text)` CALLBACK instead of touching URL/Blob themselves — tests
 * inject a spy and assert the exact payload (fakeDom has no Blob), main.ts injects this.
 */
import { el } from './dom';

export function triggerDownload(filename: string, text: string): void {
  const type = filename.endsWith('.json') ? 'application/json' : 'text/plain';
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = el('a', { attrs: { href: url, download: filename } });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
