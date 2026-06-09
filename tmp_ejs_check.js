const ejs = require('ejs');
const p = 'src/views/auth/login.ejs';
ejs.renderFile(p, { error: '<script>x</script>', userId: '"><b>' }, (e, html) => {
  if (e) { console.error('ERR', e.message); process.exit(1); }
  console.log('RENDER_OK');
  console.log('escaped_error:', html.includes('&lt;script&gt;'));
  console.log('no_raw_script:', !html.includes('<script>x'));
  console.log('userid_not_raw:', !html.includes('"><b>'));
  // render without locals (GET /login passes error:null, userId:'')
  ejs.renderFile(p, { error: null, userId: '' }, (e2, html2) => {
    if (e2) { console.error('ERR2', e2.message); process.exit(1); }
    console.log('RENDER_OK_EMPTY:', html2.includes('Log In'));
  });
});
