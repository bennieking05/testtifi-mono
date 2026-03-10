import { useEffect } from 'react';
import html2canvas from 'html2canvas';
import { useLocation } from 'react-router-dom';

const ENABLED = import.meta.env.VITE_SNAPSHOTS === 'true';
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

async function postBlob(url: string, body: Blob, filename: string) {
  const form = new FormData();
  form.append('file', body, filename);
  try {
    await fetch(url, { method: 'POST', body: form, keepalive: true });
  } catch {}
}

export function useAutoSnapshots() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (!ENABLED) return;
    const take = async (tag: string) => {
      const canvas = await html2canvas(document.body, { useCORS: true, logging: false });
      await new Promise<void>(res => canvas.toBlob(async blob => {
        if (!blob) return res();
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        await postBlob(`${BASE}/api/snapshots`, blob, `${ts}_${tag}.png`);
        res();
      }));
      const meta = { ts: Date.now(), url: location.href, tag };
      navigator.sendBeacon(`${BASE}/api/snapshots/meta`, new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    };
    take(`route-${pathname}`);
  }, [pathname]);

  useEffect(() => {
    if (!ENABLED) return;
    const handler = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest('button, [role="button"], a[href]')) {
        const label = (el.textContent || el.getAttribute('aria-label') || 'elem').trim().replace(/\s+/g, '_').slice(0,24);
        html2canvas(document.body, { useCORS: true, logging: false }).then(canvas => {
          canvas.toBlob(blob => {
            if (!blob) return;
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const form = new FormData();
            form.append('file', blob, `${ts}_button-${label}.png`);
            navigator.sendBeacon(`${BASE}/api/snapshots`, form);
          });
        });
      }
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, []);
}

