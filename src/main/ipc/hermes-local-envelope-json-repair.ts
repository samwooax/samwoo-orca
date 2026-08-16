// Deterministic repair for model-emitted envelope JSON. Observed Hermes replies
// add spurious closing braces to long single-line JSON and repeat the identical
// mistake when asked to correct it: after the document (messages 4833 and
// 4940/4942/4944) or at an interior boundary (messages 4853/4855/4857). Two
// repairs cover exactly those classes: a complete JSON value followed only by
// stray closing delimiters keeps the untouched value, and an interior defect is
// fixed by deleting exactly one closing delimiter where the next token is
// structural, only when every parseable candidate yields the same text.
// Ambiguity, truncation, or any other defect stays fail-closed for the
// model-repair round, and schema validation still runs on the repaired JSON.

const MAX_CANDIDATE_PARSE_BYTES = 64 * 1024 * 1024

// A deletion is only considered where it cannot join two value tokens.
function hasStructuralFollower(payload: string, index: number): boolean {
  for (let cursor = index + 1; cursor < payload.length; cursor += 1) {
    const char = payload[cursor]
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      continue
    }
    return char === ',' || char === ']' || char === '}'
  }
  return true
}

// Closer positions up to and including the first structurally impossible one.
// A single deletion after that point cannot fix the already-impossible prefix.
function closerCandidates(payload: string): number[] | null {
  const stack: ('{' | '[')[] = []
  const candidates: number[] = []
  let inString = false
  let escaped = false
  for (let index = 0; index < payload.length; index += 1) {
    const char = payload[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
    } else if (char === '{' || char === '[') {
      stack.push(char)
    } else if (char === '}' || char === ']') {
      if (hasStructuralFollower(payload, index)) {
        candidates.push(index)
      }
      if (stack.at(-1) !== (char === '}' ? '{' : '[')) {
        return candidates
      }
      stack.pop()
    }
  }
  return null
}

// A complete top-level value trailed only by stray closers and whitespace.
function completeValueBeforeTrailingClosers(payload: string): string | null {
  const stack: ('{' | '[')[] = []
  let inString = false
  let escaped = false
  let opened = false
  for (let index = 0; index < payload.length; index += 1) {
    const char = payload[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
    } else if (char === '{' || char === '[') {
      stack.push(char)
      opened = true
    } else if (char === '}' || char === ']') {
      if (stack.at(-1) !== (char === '}' ? '{' : '[')) {
        return null
      }
      stack.pop()
      if (opened && stack.length === 0) {
        const trailing = payload.slice(index + 1)
        return trailing.trim().length > 0 && /^[\s\]}]*$/.test(trailing)
          ? payload.slice(0, index + 1)
          : null
      }
    }
  }
  return null
}

export function parseEnvelopeJson(payload: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(payload) as unknown }
  } catch {
    // Fall through to the deterministic repairs.
  }
  const prefix = completeValueBeforeTrailingClosers(payload)
  if (prefix !== null) {
    try {
      return { value: JSON.parse(prefix) as unknown }
    } catch {
      // The prefix itself is defective; try the single-deletion repair below.
    }
  }
  const candidates = closerCandidates(payload)
  if (!candidates || candidates.length * payload.length > MAX_CANDIDATE_PARSE_BYTES) {
    return null
  }
  let repaired: { value: unknown; text: string } | null = null
  for (const position of candidates) {
    const text = payload.slice(0, position) + payload.slice(position + 1)
    let value: unknown
    try {
      value = JSON.parse(text) as unknown
    } catch {
      continue
    }
    if (repaired && repaired.text !== text) {
      return null
    }
    repaired ??= { value, text }
  }
  return repaired && { value: repaired.value }
}
