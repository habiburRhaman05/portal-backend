require('dotenv').config();
const app = require('./api/index');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BDCap portal backend running on http://localhost:${PORT}`);
  console.log(`  Sign in:  http://localhost:${PORT}/clients`);
  console.log(`  Portal:   http://localhost:${PORT}/clients/portal`);
  console.log(`  Health:   http://localhost:${PORT}/api/health`);
});
