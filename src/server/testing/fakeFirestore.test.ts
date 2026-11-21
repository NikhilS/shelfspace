import {FieldPath, FieldValue} from 'firebase-admin/firestore';
import {describe, expect, it} from 'vitest';
import {createFakeFirestore} from './fakeFirestore';

describe('FakeFirestore In-Memory Engine (src/server/testing/fakeFirestore.ts)', () => {
  it('supports CRUD, nested subcollections, FieldValue sentinels, and getAll', async () => {
    const {db} = createFakeFirestore();
    const libRef = db.collection('libraries').doc('lib-1');
    await libRef.set({
      name: 'Main Archive',
      bookCount: 1,
      collaboratorEmails: ['ada@example.com'],
      updatedAt: FieldValue.serverTimestamp(),
    });

    await libRef.update({
      bookCount: FieldValue.increment(2),
      collaboratorEmails: FieldValue.arrayUnion('charles@example.com'),
      'access.ada@example_com': 'editor',
    });

    const bookRef = libRef.collection('books').doc('b-1');
    await bookRef.set({
      title: 'Analytical Engine',
      primaryGenreLower: 'science',
      missingFlags: ['geo', 'synopsis'],
      tempField: 'remove-me',
    });
    await bookRef.update({
      tempField: FieldValue.delete(),
    });

    const [libSnap, bookSnap] = await db.getAll(libRef, bookRef);
    expect(libSnap.exists).toBe(true);
    expect(libSnap.data()?.bookCount).toBe(3);
    expect(libSnap.data()?.collaboratorEmails).toEqual([
      'ada@example.com',
      'charles@example.com',
    ]);
    const updatedAtVal = libSnap.data()?.updatedAt as
      {toDate?: unknown} | undefined;
    expect(typeof updatedAtVal?.toDate).toBe('function');

    expect(bookSnap.exists).toBe(true);
    expect(bookSnap.data()?.tempField).toBeUndefined();
    expect(bookSnap.data()?.primaryGenreLower).toBe('science');
  });

  it('supports array-contains, FieldPath, orderBy, startAfter cursor pagination, select projection, and count', async () => {
    const {db} = createFakeFirestore();
    const booksCol = db
      .collection('libraries')
      .doc('lib-1')
      .collection('books');

    await booksCol.doc('b-1').set({
      title: 'Alpha',
      addedAt: '2026-01-01T00:00:00.000Z',
      missingFlags: ['geo', 'coverImage'],
      heavyIgnored: 'large-text',
    });
    await booksCol.doc('b-2').set({
      title: 'Beta',
      addedAt: '2026-01-02T00:00:00.000Z',
      missingFlags: ['geo'],
      heavyIgnored: 'large-text',
    });
    await booksCol.doc('b-3').set({
      title: 'Gamma',
      addedAt: '2026-01-03T00:00:00.000Z',
      missingFlags: ['synopsis'],
      heavyIgnored: 'large-text',
    });

    const countSnap = await booksCol
      .where('missingFlags', 'array-contains', 'geo')
      .count()
      .get();
    expect(countSnap.data().count).toBe(2);

    const page1 = await booksCol
      .where('missingFlags', 'array-contains', 'geo')
      .orderBy('addedAt', 'desc')
      .limit(1)
      .select('title')
      .get();

    expect(page1.docs).toHaveLength(1);
    expect(page1.docs[0].id).toBe('b-2');
    expect(page1.docs[0].data()).toEqual({title: 'Beta'});

    const cursorDoc = await booksCol.doc('b-2').get();
    const page2 = await booksCol
      .where('missingFlags', 'array-contains', 'geo')
      .orderBy('addedAt', 'desc')
      .startAfter(cursorDoc)
      .limit(2)
      .get();

    expect(page2.docs.map(d => d.id)).toEqual(['b-1']);

    // Verify FieldPath nested lookup
    await db
      .collection('libraries')
      .doc('lib-shared')
      .set({
        name: 'Shared',
        access: {'reader@example.com': 'viewer'},
      });

    const sharedSnap = await db
      .collection('libraries')
      .where(new FieldPath('access', 'reader@example.com'), 'in', [
        'viewer',
        'editor',
      ])
      .get();
    expect(sharedSnap.docs.map(d => d.id)).toEqual(['lib-shared']);
  });

  it('supports atomic batches, transactions, and real-time onSnapshot notifications', async () => {
    const {db} = createFakeFirestore();
    const jobRef = db
      .collection('libraries')
      .doc('lib-1')
      .collection('jobs')
      .doc('job-1');

    const observedStatuses: string[] = [];
    const unsubscribe = jobRef.onSnapshot(snap => {
      if (snap.exists) {
        observedStatuses.push(String(snap.data()?.status));
      }
    });

    const batch = db.batch();
    batch.set(jobRef, {status: 'running', completedBooks: 0});
    await batch.commit();

    await db.runTransaction(async tx => {
      const current = await tx.get(jobRef);
      const prevCompleted = Number(current.data()?.completedBooks || 0);
      tx.update(jobRef, {
        status: 'completed',
        completedBooks: prevCompleted + 5,
      });
    });

    await new Promise(resolve => setTimeout(resolve, 10));
    unsubscribe();

    expect(observedStatuses).toContain('running');
    expect(observedStatuses).toContain('completed');
  });
});
