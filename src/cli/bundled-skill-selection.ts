import { RuntimeClientError } from './runtime-client'

export type BundledSkillGuide = {
  name: string
  description: string
  markdown: string
  fullMarkdown: string
  aliases: readonly string[]
}

export function canonicalGuides(guides: readonly BundledSkillGuide[]): BundledSkillGuide[] {
  return [...guides].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  )
}

function guideByTopic(guides: BundledSkillGuide[]): Map<string, BundledSkillGuide> {
  // Why: installed stubs may retain an old topic forever, so aliases and canonical names share one lookup.
  return new Map(
    guides.flatMap((guide) => [guide.name, ...guide.aliases].map((name) => [name, guide]))
  )
}

export function requireTopic(
  flags: Map<string, string | boolean>,
  guides: BundledSkillGuide[]
): BundledSkillGuide {
  const availableTopics = guides.map((guide) => guide.name).join(', ')
  const topic = flags.get('topic')
  if (typeof topic !== 'string' || topic.length === 0) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Missing skill topic. Available topics: ${availableTopics}`
    )
  }
  const guide = guideByTopic(guides).get(topic)
  if (!guide) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Unknown skill topic "${topic}". Available topics: ${availableTopics}`
    )
  }
  return guide
}

export function requireTopics(
  flags: Map<string, string | boolean>,
  guides: BundledSkillGuide[]
): BundledSkillGuide[] {
  const rawTopics = flags.get('topics')
  if (typeof rawTopics !== 'string' || rawTopics.trim().length === 0) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Flag --topics requires a comma-separated value.'
    )
  }
  const guidesByTopic = guideByTopic(guides)
  const selected = rawTopics.split(',').map((topic) => topic.trim())
  const unknown = selected.find((topic) => !guidesByTopic.has(topic))
  if (unknown) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Unknown skill topic "${unknown}". Available topics: ${guides.map((guide) => guide.name).join(', ')}`
    )
  }
  return [
    ...new Map(
      selected.map((topic) => {
        const guide = guidesByTopic.get(topic) as BundledSkillGuide
        return [guide.name, guide]
      })
    ).values()
  ]
}
