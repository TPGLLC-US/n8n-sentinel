# Workflow Development

This directory contains the source files for the Sentinel Reporter n8n workflow.

## Structure

```
workflow/
├── build.js                  # Compiler: template + scripts → reporter-workflow.json
├── workflow.template.json    # Workflow structure with {{SCRIPT:name}} placeholders
├── scripts/                  # Code node scripts (one file per Code node)
│   ├── route-telemetry.js    # Detects which trigger fired
│   ├── calculate-delta.js    # Computes execution time delta for incremental sync
│   └── build-payload.js      # Assembles the telemetry payload
└── README.md
```

## How it works

1. **Edit** scripts in `workflow/scripts/*.js` as normal JavaScript files (with IDE support)
2. **Edit** node structure in `workflow/workflow.template.json`
3. **Build** with `npm run build:workflow` — compiles to `client/public/reporter-workflow.json`

Placeholders in the template use the format `{{SCRIPT:filename}}` (without `.js`).
The build script reads each referenced script file and injects it into the `jsCode` field.

## Commands

```bash
# Build just the workflow
npm run build:workflow

# Full project build (includes workflow)
npm run build
```

## Adding a new Code node

1. Create `workflow/scripts/my-script.js`
2. In `workflow.template.json`, add the node with `"jsCode": "{{SCRIPT:my-script}}"`
3. Run `npm run build:workflow`
