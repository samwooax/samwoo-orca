import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const SKILL_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['skills', 'list'],
    summary: 'List version-matched skill guides bundled with this Orca CLI',
    usage: 'orca skills list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Reads bundled guide metadata locally without contacting the Orca runtime.',
      'With --json, prints a topics array of canonical names and one-line descriptions.'
    ]
  },
  {
    path: ['skills', 'get'],
    aliases: [['skills', 'show']],
    summary: 'Print a version-matched skill guide as Markdown',
    usage: 'orca skills get <topic> [--full] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'topic', 'full'],
    positionalArgs: ['topic'],
    notes: [
      'Reads bundled guide content locally without contacting the Orca runtime.',
      'Use --full to include bundled reference documents when the guide provides them.',
      'Use --json for a deterministic object containing canonical topic metadata and content.'
    ],
    examples: ['orca skills get orca-cli', 'orca skills get orchestration --full']
  },
  {
    path: ['skills', 'install'],
    summary: 'Install bundled skill guides without requiring Node.js or npx',
    usage: 'orca skills install --topics <name,name,...> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'topics'],
    notes: [
      'Installs the version-matched bundled guides into supported global agent skill homes.',
      'Runs locally without contacting the Orca runtime or requiring Node.js/npm.'
    ],
    examples: ['orca skills install --topics orca-cli,computer-use,orchestration']
  }
]
