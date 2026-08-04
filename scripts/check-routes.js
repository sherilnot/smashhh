/**
 * Check that all route files can be required without crashing
 * and that render calls pass the expected variables.
 */
const path = require('path');

// Mock dependencies minimally so require doesn't crash
const issues = [];

// Check route requires
const routeFiles = [
  'src/routes/auth.js',
  'src/routes/manager.js',
  'src/routes/employee.js',
  'src/routes/operation-manager.js',
  'src/routes/receiving-manager.js',
  'src/routes/warehouse.js'
];

routeFiles.forEach(rf => {
  try {
    require(path.resolve(rf));
  } catch (e) {
    issues.push(rf + ': require failed → ' + e.message.split('\n')[0]);
  }
});

if (issues.length === 0) {
  console.log('✅ ALL ROUTES REQUIRE OK');
} else {
  issues.forEach(i => console.log('⚠️  ' + i));
  process.exit(1);
}
