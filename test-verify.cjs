const admin = require('firebase-admin');
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));

admin.initializeApp({
  projectId: config.projectId,
});

async function run() {
  try {
    // Generate a fake token just to see if it throws a local verification error or an API error
    await admin.auth().verifyIdToken("fake-token");
  } catch (e) {
    console.error("ERROR:", e);
  }
}
run();
