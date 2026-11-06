/** Fail early for missing markup instead of scattering nullable DOM assertions. */
export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing application element: ${id}`);
  return element as T;
}
export const input = (id: string) => el<HTMLInputElement>(id);
export const select = (id: string) => el<HTMLSelectElement>(id);
export const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
