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

  it('fails closed on truncated JSON instead of completing it', () => {
    expect(parseEnvelopeJson('{"version":1,"operations":[{"id":"a"')).toBeNull()
    expect(parseEnvelopeJson('{"version":1,"operations":[{"id":"a"}]')).toBeNull()
    expect(parseEnvelopeJson('{"text":"unterminated')).toBeNull()
  })

  it('fails closed when repairs exceed the bounded delimiter budget', () => {
    expect(parseEnvelopeJson('{"a":[1]}}}}}}')).toBeNull()
  })

  it('fails closed when dropping impossible closers still leaves invalid JSON', () => {
    expect(parseEnvelopeJson('{"a":[1]}} "trailing"')).toBeNull()
    expect(parseEnvelopeJson('{"a":1,}')).toBeNull()
  })
})
