import {
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

let testEnv: RulesTestEnvironment;

export async function getTestEnv(): Promise<RulesTestEnvironment> {
  if (!testEnv) {
    testEnv = await initializeTestEnvironment({
      projectId: 'ai-studio-6fef0e30-0700-498b-b173-2d35028684f8',
      firestore: {
        host: '127.0.0.1',
        port: 8080,
      },
    });
  }
  return testEnv;
}

export async function cleanupFirestore() {
  const env = await getTestEnv();
  await env.clearFirestore();
}
