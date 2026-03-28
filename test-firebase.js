const { initializeApp, cert } = require("firebase-admin/app");

try {
  const c = cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  });
  initializeApp({ credential: c });
  console.log("SUCCESS!");
} catch (e) {
  console.error("ERROR:", e);
}
