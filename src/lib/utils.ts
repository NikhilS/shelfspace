import {FirestoreDate} from '../types';

export function toTitleCase(str: string) {
  if (!str) return '';
  return str.replace(
    /\w\S*/g,
    txt => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase(),
  );
}

export function getFirestoreTime(
  dateObj?: string | number | Date | FirestoreDate | null,
): number {
  if (!dateObj) return 0;

  if (
    typeof dateObj === 'object' &&
    'toMillis' in dateObj &&
    typeof dateObj.toMillis === 'function'
  ) {
    return dateObj.toMillis();
  }

  const d = new Date(dateObj as string | number | Date);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
