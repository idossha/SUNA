import { defineConfig } from 'vitepress'

/**
 * The SUNA documentation site.
 *
 * `base` is read from an env var so the same build serves both localhost
 * (`/`) and GitHub Pages under a project path (`/SUNA/`) — set
 * SUNA_DOCS_BASE=/SUNA/ in the Pages workflow and leave it unset locally.
 */
/**
 * `base` must be interpolated into head links by hand: VitePress rebases asset
 * URLs it finds in markdown and the theme, but emits `head` entries verbatim.
 * A bare `/favicon.svg` 404s on a project-path Pages deploy.
 */
const base = process.env.SUNA_DOCS_BASE ?? '/'

export default defineConfig({
  title: 'SUNA',
  description:
    'An academic writing platform: manuscripts, figures, references and journal compliance in one plain-text workspace.',
  base,
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,
  appearance: 'dark',
  ignoreDeadLinks: false,
  // README.md documents how to build the site; it is not a page of it.
  srcExclude: ['README.md'],

  // There is no marketing landing page: the site's root IS the first page of
  // the guide, so a visitor arrives in the documentation rather than one
  // click away from it.
  rewrites: { 'guide/what-is-suna.md': 'index.md' },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    ['meta', { name: 'theme-color', content: '#16161c' }],
    ['meta', { name: 'color-scheme', content: 'dark light' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'SUNA — academic writing platform' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Manuscripts, figures, references and journal compliance in one plain-text workspace.'
      }
    ]
  ],

  markdown: {
    theme: { light: 'github-light', dark: 'github-dark' },
    lineNumbers: false
  },

  themeConfig: {
    siteTitle: 'SUNA',
    outline: { level: [2, 3], label: 'On this page' },

    // No `nav`. The sidebar already carries every page, and a top bar
    // repeating two of its section names was navigation that pointed back at
    // what was already on screen. The repository link is the one thing the
    // sidebar cannot offer.
    socialLinks: [{ icon: 'github', link: 'https://github.com/idossha/SUNA' }],

    sidebar: [
      {
        text: 'Getting started',
        collapsed: false,
        items: [
          { text: 'What SUNA is', link: '/' },
          { text: 'Install and run', link: '/guide/install' },
          { text: 'Quickstart', link: '/guide/quickstart' },
          { text: 'A typical workflow', link: '/guide/workflow' }
        ]
      },
      {
        text: 'The workspace',
        collapsed: false,
        items: [
          { text: 'Tour of the interface', link: '/guide/tour' },
          { text: 'Anatomy of a project', link: '/guide/project' },
          { text: 'Settings and themes', link: '/guide/settings' }
        ]
      },
      {
        text: 'Writing',
        collapsed: false,
        items: [
          { text: 'The manuscript', link: '/writing/manuscript' },
          { text: 'SciMark syntax', link: '/writing/scimark' },
          { text: 'The editor', link: '/writing/editor' },
          { text: 'References and citations', link: '/writing/references' },
          { text: 'Review comments', link: '/writing/comments' },
          { text: 'Notebooks and code', link: '/writing/notebooks' }
        ]
      },
      {
        text: 'Letters and review',
        collapsed: false,
        items: [
          { text: 'Cover letters', link: '/documents/letters' },
          { text: 'Peer review', link: '/documents/review' }
        ]
      },
      {
        text: 'Figures',
        collapsed: false,
        items: [
          { text: 'The figure canvas', link: '/figures/canvas' },
          { text: 'Figures from code', link: '/figures/from-code' }
        ]
      },
      {
        text: 'Publishing',
        collapsed: false,
        items: [
          { text: 'Journal profiles', link: '/publishing/profiles' },
          { text: 'Compliance checks', link: '/publishing/compliance' },
          { text: 'Export', link: '/publishing/export' }
        ]
      },
      {
        text: 'Working with AI',
        collapsed: false,
        items: [
          { text: 'How SUNA works with agents', link: '/ai/overview' },
          { text: 'Context files', link: '/ai/context' },
          { text: 'MCP reference', link: '/ai/mcp' },
          { text: 'AI inside the app', link: '/ai/in-app' },
          { text: 'Directed AI actions', link: '/ai/directed' }
        ]
      },
      {
        text: 'Reference',
        collapsed: false,
        items: [
          { text: 'Keyboard shortcuts', link: '/reference/shortcuts' },
          { text: 'Files and formats', link: '/reference/files' },
          { text: 'FAQ', link: '/reference/faq' }
        ]
      },
      // GENERATED, and collapsed because this half of the site is not for the
      // people the rest of it is written for. Every page here is a mirror of a
      // file in the repository, written by website/scripts/sync-docs.mjs — the
      // developer documentation has exactly one copy, and this is a view of
      // it. Adding a page means adding it to PAGES in that script as well.
      {
        text: 'Developers',
        collapsed: true,
        items: [
          { text: 'Working on SUNA', link: '/developers/contributing' },
          { text: 'Architecture', link: '/developers/architecture' },
          { text: 'Decision log', link: '/developers/decisions' },
          { text: 'Testing', link: '/developers/testing' },
          { text: 'Packaging', link: '/developers/packaging' },
          { text: 'Releasing', link: '/developers/releasing' },
          { text: 'Automation', link: '/developers/automation' },
          { text: 'Configuration reference', link: '/developers/configuration' },
          { text: 'Roadmap', link: '/developers/roadmap' },
          { text: 'GitHub OAuth', link: '/developers/github-oauth' }
        ]
      }
    ],

    search: { provider: 'local' },

    docFooter: { prev: 'Previous', next: 'Next' },

    footer: {
      message:
        'Sources of truth are JSON, Markdown, BibTeX, SVG and LaTeX. PDF and DOCX are export-only.',
      copyright: 'SUNA · an academic writing platform'
    }
  }
})
