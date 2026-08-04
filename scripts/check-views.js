const fs = require('fs');
const path = require('path');

const viewsDir = './src/views';
const issues = [];

function scan(dir) {
  fs.readdirSync(dir).forEach(f => {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) { scan(fp); return; }
    if (!f.endsWith('.ejs')) return;

    const content = fs.readFileSync(fp, 'utf8');
    const rel = fp.replace('./src/views/', '');

    // Check for include paths that don't exist
    const includeMatches = content.match(/include\(['"]([^'"]+)['"]/g) || [];
    includeMatches.forEach(inc => {
      const m = inc.match(/include\(['"]([^'"]+)['"]/);
      if (!m) return;
      const incPath = m[1];
      const resolved = path.resolve(path.dirname(fp), incPath + '.ejs');
      if (!fs.existsSync(resolved)) {
        issues.push(rel + ': missing include → ' + incPath);
      }
    });

    // Check for unclosed EJS tags
    const opens = (content.match(/<%/g) || []).length;
    const closes = (content.match(/%>/g) || []).length;
    if (opens !== closes) {
      issues.push(rel + ': mismatched EJS tags (opens=' + opens + ', closes=' + closes + ')');
    }
  });
}

scan(viewsDir);

if (issues.length === 0) {
  console.log('✅ ALL VIEWS OK — no issues found');
} else {
  issues.forEach(i => console.log('⚠️  ' + i));
  process.exit(1);
}
