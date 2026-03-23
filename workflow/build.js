#!/usr/bin/env node
/**
 * Workflow Compiler
 * 
 * Reads workflow.template.json, replaces {{SCRIPT:filename}} placeholders
 * with the contents of the corresponding scripts/*.js files, and writes
 * the compiled workflow to client/public/reporter-workflow.json.
 * 
 * Usage:
 *   node workflow/build.js
 */

const fs = require('fs');
const path = require('path');

const WORKFLOW_DIR = __dirname;
const SCRIPTS_DIR = path.join(WORKFLOW_DIR, 'scripts');
const SQL_DIR = path.join(WORKFLOW_DIR, 'sql');
const TEMPLATE_PATH = path.join(WORKFLOW_DIR, 'workflow.template.json');
const OUTPUT_PATH = path.join(WORKFLOW_DIR, '..', 'client', 'public', 'reporter-workflow.json');

// Read the template as raw text so we can do string replacement
let template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

// Find all {{SCRIPT:name}} placeholders
const scriptPattern = /\{\{SCRIPT:([a-zA-Z0-9_-]+)\}\}/g;
let match;
const scripts = new Map();

while ((match = scriptPattern.exec(template)) !== null) {
  const scriptName = match[1];
  if (!scripts.has(scriptName)) {
    const scriptPath = path.join(SCRIPTS_DIR, `${scriptName}.js`);
    if (!fs.existsSync(scriptPath)) {
      console.error(`❌ Script not found: ${scriptPath}`);
      process.exit(1);
    }
    scripts.set(scriptName, fs.readFileSync(scriptPath, 'utf8'));
    console.log(`  📄 Loaded scripts/${scriptName}.js`);
  }
}

// Find all {{SQL:name}} placeholders
const sqlPattern = /\{\{SQL:([a-zA-Z0-9_-]+)\}\}/g;
const sqlFiles = new Map();

while ((match = sqlPattern.exec(template)) !== null) {
  const sqlName = match[1];
  if (!sqlFiles.has(sqlName)) {
    const sqlPath = path.join(SQL_DIR, `${sqlName}.sql`);
    if (!fs.existsSync(sqlPath)) {
      console.error(`❌ SQL not found: ${sqlPath}`);
      process.exit(1);
    }
    sqlFiles.set(sqlName, fs.readFileSync(sqlPath, 'utf8'));
    console.log(`  📄 Loaded sql/${sqlName}.sql`);
  }
}

// The template has placeholders inside JSON string values like:
//   "jsCode": "{{SCRIPT:route-telemetry}}"
// We need to parse the JSON, find jsCode fields, and replace with actual script content.
// We can't do naive string replacement because the script content needs to be JSON-escaped.

const workflow = JSON.parse(template);

for (const node of workflow.nodes) {
  if (node.parameters?.jsCode && typeof node.parameters.jsCode === 'string') {
    const jsCode = node.parameters.jsCode;
    const placeholderMatch = jsCode.match(/^\{\{SCRIPT:([a-zA-Z0-9_-]+)\}\}$/);
    if (placeholderMatch) {
      const scriptName = placeholderMatch[1];
      const scriptContent = scripts.get(scriptName);
      if (!scriptContent) {
        console.error(`❌ Script "${scriptName}" referenced but not loaded`);
        process.exit(1);
      }
      node.parameters.jsCode = scriptContent.trim();
      console.log(`  ✅ Injected ${scriptName}.js → "${node.name}"`);
    }
  }

  // Inject SQL into Postgres node query parameters
  if (node.parameters?.query && typeof node.parameters.query === 'string') {
    const query = node.parameters.query;
    const sqlMatch = query.match(/^\{\{SQL:([a-zA-Z0-9_-]+)\}\}$/);
    if (sqlMatch) {
      const sqlName = sqlMatch[1];
      const sqlContent = sqlFiles.get(sqlName);
      if (!sqlContent) {
        console.error(`❌ SQL "${sqlName}" referenced but not loaded`);
        process.exit(1);
      }
      // Strip SQL comments for cleaner query
      const cleaned = sqlContent.split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n').trim();

      // If SQL contains __EXEC_IDS__ placeholder, wrap in n8n expression
      // that injects execution IDs from the previous node's input
      if (cleaned.includes('__EXEC_IDS__')) {
        const escapedSql = cleaned
          .replace(/\\/g, '\\\\')
          .replace(/`/g, '\\`');
        const expr = '={{ `' + escapedSql.replace(
          '__EXEC_IDS__',
          "${$input.first().json.data ? $input.first().json.data.map(d => d.id).join(',') : '0'}"
        ) + '` }}';
        node.parameters.query = expr;
      } else {
        node.parameters.query = cleaned;
      }
      console.log(`  ✅ Injected ${sqlName}.sql → "${node.name}"`);
    }
  }
}

// Write the compiled workflow
const output = JSON.stringify(workflow, null, 2) + '\n';
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, output);

console.log(`\n✅ Compiled workflow → ${path.relative(path.join(WORKFLOW_DIR, '..'), OUTPUT_PATH)}`);
console.log(`   ${workflow.nodes.length} nodes, ${Object.keys(workflow.connections).length} connections`);
