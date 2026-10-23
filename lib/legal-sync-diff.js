export function normalizeLegalText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

export function compareLegalPage(existingBody, proposedBody) {
  const current = normalizeLegalText(existingBody);
  const proposed = normalizeLegalText(proposedBody);
  return {
    changed: current !== proposed,
    currentEmpty: current.length === 0,
    proposedEmpty: proposed.length === 0,
    requiresReview: current !== proposed,
    safeToAutoOverwrite: false
  };
}

export function findLegalPageCandidates(pages) {
  if (!Array.isArray(pages)) return [];
  return pages.filter(page =>
    page && (
      String(page.handle || '').trim().toLowerCase() === 'legal-notice' ||
      String(page.title || '').trim() === '特定商取引法に基づく表記'
    )
  ).map(page => ({
    id: String(page.id || ''),
    title: String(page.title || ''),
    handle: String(page.handle || ''),
    body: String(page.body || '')
  }));
}
