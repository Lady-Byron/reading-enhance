import app from 'flarum/forum/app';

export function parseDiscussionIdFromUrl(url: URL): string | null {
  // 兼容 /d/123-slug 和 /d/123
  const parts = url.pathname.split('/').filter(Boolean);
  const dIndex = parts.indexOf('d');
  
  if (dIndex === -1 || parts.length <= dIndex + 1) return null;
  
  const idPart = parts[dIndex + 1];
  const match = /^(\d+)/.exec(idPart);
  return match ? match[1] : null;
}

export function isSameOrigin(url: URL): boolean {
  return url.origin === window.location.origin;
}
