// Locale-aware display helpers for entities with bilingual names.

// Returns the Arabic name when in RTL mode (with English fallback),
// otherwise returns the English name.
export function localizedName(entity, rtl) {
  if (!entity) return '';
  if (rtl && entity.nameAr) return entity.nameAr;
  return entity.name || entity.nameAr || '';
}
