// ─── PostgREST search-term sanitiser ──────────────────────────────────────────
// Supabase's `.or("a.ilike.%x%,b.ilike.%x%")` builds a PostgREST `or=` filter
// whose grammar gives meaning to `,` (predicate separator), `.` (column/operator
// /value separator), `()` (grouping) and `:` . Interpolating raw query-string
// input into that string lets a caller close the current predicate and append
// their own - filter tampering and error-based enumeration at minimum.
//
// Rather than trying to escape the grammar, strip every character that carries
// meaning in it, plus the LIKE wildcards `%` and `_` so a search cannot turn
// into a full-table scan. The remaining text still matches via ilike, so a
// search for "Main St." simply behaves as "Main St".

function sanitizeSearchTerm(input, maxLen = 100) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[,.()<>:"'\\%_*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

module.exports = { sanitizeSearchTerm };
