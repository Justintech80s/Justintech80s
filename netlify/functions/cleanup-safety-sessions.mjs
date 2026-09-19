import { getStore } from "@netlify/blobs";

const STORE = "activate-siren-safety-sessions";

export default async () => {
  const store = getStore(STORE);
  const { blobs } = await store.list();
  const now = Date.now();

  let scanned = 0;
  let deleted = 0;

  for (const blob of blobs) {
    scanned += 1;
    const entry = await store.getMetadata(blob.key);
    const expiration = Number(entry?.metadata?.expiration || 0);

    if (expiration && expiration <= now) {
      await store.delete(blob.key);
      deleted += 1;
    }
  }

  console.log(`Activate Siren cleanup scanned ${scanned} sessions and deleted ${deleted} expired sessions.`);
  return new Response(null, { status: 204 });
};

export const config = {
  schedule: "@hourly",
};
