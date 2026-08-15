import { describe, expect, it } from 'vitest'
import { parseEnvelopeJson } from './hermes-local-envelope-json-repair'

describe('Hermes envelope JSON delimiter repair', () => {
  it('parses valid JSON without modification', () => {
    expect(parseEnvelopeJson('{"version":1,"operations":[{"id":"a"}]}')).toEqual({
      value: { version: 1, operations: [{ id: 'a' }] }
    })
  })

  it('drops the spurious brace Hermes emitted after the last create_pdf page', () => {
    // Structural shape of production messages 4853/4855/4857: one extra `}` between
    // the closed page object and the pages array close.
    const payload =
      '{"version":1,"operations":[{"id":"pdf","kind":"create_pdf","outputPath":"out.pdf","documentSpec":{"pageSize":"A4","pages":[{"elements":[{"type":"text","text":"본문"}]}}]}}]}'
    expect(parseEnvelopeJson(payload)).toEqual({
      value: {
        version: 1,
        operations: [
          {
            id: 'pdf',
            kind: 'create_pdf',
            outputPath: 'out.pdf',
            documentSpec: { pageSize: 'A4', pages: [{ elements: [{ type: 'text', text: '본문' }] }] }
          }
        ]
      }
    })
  })

  it('drops a trailing closer emitted after the envelope object already closed', () => {
    expect(parseEnvelopeJson('{"version":1,"operations":[{"id":"a"}]}}')).toEqual({
      value: { version: 1, operations: [{ id: 'a' }] }
    })
  })

  it('never rewrites brackets inside string values', () => {
    const payload = '{"text":"tail }]}}]} stays","list":[1]}]'
    expect(parseEnvelopeJson(payload)).toEqual({
      value: { text: 'tail }]}}]} stays', list: [1] }
    })
  })

  it('never splices scalar tokens together by deleting the closer between them', () => {
    expect(parseEnvelopeJson('{"a":[1}2]}')).toBeNull()
    expect(parseEnvelopeJson('{"a":[1}.5]}')).toBeNull()
    expect(parseEnvelopeJson('{"a":[n}ull]}')).toBeNull()
    expect(parseEnvelopeJson('{"a":[tru}e]}')).toBeNull()
  })

  it('fails closed when more than one distinct single-deletion reading parses', () => {
    // A spurious `]` after the 1 and the model's final `]` are both deletable;
    // the two readings regroup values differently, so neither may be chosen.
    expect(parseEnvelopeJson('{"a":[[1],2]]}')).toBeNull()
    expect(parseEnvelopeJson('{"a":[[1,2],[3],4]]}')).toBeNull()
  })

  it('fails closed on truncated JSON instead of completing it', () => {
    expect(parseEnvelopeJson('{"version":1,"operations":[{"id":"a"')).toBeNull()
    expect(parseEnvelopeJson('{"version":1,"operations":[{"id":"a"}]')).toBeNull()
    expect(parseEnvelopeJson('{"text":"unterminated')).toBeNull()
  })

  it('fails closed when no single deletion yields valid JSON', () => {
    expect(parseEnvelopeJson('{"a":[1]}}}}}}')).toBeNull()
    expect(parseEnvelopeJson('{"a":[1]}} "trailing"')).toBeNull()
    expect(parseEnvelopeJson('{"a":1,}')).toBeNull()
  })
})
