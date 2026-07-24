const { GoogleAuth } = require('google-auth-library');
async function run() {
  const auth = new GoogleAuth({
    scopes: 'https://www.googleapis.com/auth/datastore'
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  console.log("Token:", token.token ? "got token" : "no token");
  
  const fs = require('fs');
  const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
  const url = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/appSettings/allowlist/users?pageSize=1`;
  
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token.token}` }
  });
  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Body:", text);
}
run();
