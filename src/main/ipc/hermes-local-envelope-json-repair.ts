// Deterministic repair for model-emitted envelope JSON. Observed Hermes replies
// (messages 4833, 4853/4855/4857) add a spurious closing brace at a structural
// boundary of long single-line JSON and repeat the identical mistake when asked
// to correct it, so the host drops closers that are impossible at their position.
// Strings and values are never modified and truncated JSON is never completed,
// so the unchanged schema validation after parsing stays fail-closed.

const MAX_DROPPED_CLOSERS = 4

function dropImpossibleClosers(payload: string): string | null {
  const stack: ('{' | '[')[] = []
  let repaired = ''
  let inString = false
  let escaped = false
  let dropped = 0
  for (const char of payload) {
    if (inString) {
      repaired += char
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
      if (stack.at(-1) !== (char === '}' ? '{' : '[')) {
        dropped += 1
        if (dropped > MAX_DROPPED_CLOSERS) {
          return null
        }
        continue
      }
      stack.pop()
    }
    repaired += char
  }
  return dropped > 0 && !inString && stack.length === 0 ? repaired : null
}

export function parseEnvelopeJson(payload: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(payload) as unknown }
  } catch {
    const repaired = dropImpossibleClosers(payload)
    if (repaired === null) {
      return null
    }
    try {
      return { value: JSON.parse(repaired) as unknown }
    } catch {
      return null
    }
  }
}
