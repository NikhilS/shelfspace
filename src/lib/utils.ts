export function toTitleCase(str: string) {
  if (!str) return '';
  return str.replace(
    /\w\S*/g,
    txt => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase(),
  );
}
