// Deterministic repair for model-emitted envelope JSON. Observed Hermes replies
// (messages 4833, 4853/4855/4857) add one spurious closing brace at a structural
// boundary of long single-line JSON and repeat the identical mistake when asked
// to correct it. The host repairs only that class: it deletes exactly one closing
// delimiter, only where the next token is structural so scalar tokens can never
// splice together, and only when every parseable single-deletion candidate yields
// the same text. Ambiguity, truncation, or any other defect stays fail-closed for
// the model-repair round, and schema validation still runs on the repaired JSON.

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

export function parseEnvelopeJson(payload: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(payload) as unknown }
  } catch {
    // Fall through to the bounded single-deletion repair.
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
