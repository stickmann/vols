/** Тёмный или светлый цвет для текста/меток поверх заливки hex. */
export function contrastOn(hex: string): "#111827" | "#ffffff" {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#111827";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h!, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return lum > 0.4 ? "#111827" : "#ffffff";
}

export function colorLabel(c: { name: string; marks: number }) {
  if (!c.marks) return c.name;
  return `${c.name} + ${c.marks} ${c.marks === 1 ? "метка" : c.marks < 5 ? "метки" : "меток"}`;
}
