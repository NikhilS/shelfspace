const admin = require('firebase-admin');
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: config.projectId,
});

async function run() {
  try {
    const users = await admin.auth().listUsers(1);
    console.log("SUCCESS:", users.users.length);
  } catch (e) {
    console.error("ERROR:", e);
  }
}
run();
