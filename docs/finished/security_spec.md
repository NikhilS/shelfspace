# Security Specification - Book Library App

## 1. Data Invariants
- A `Book` cannot exist without a parent `Library`.
- A `Library` must have a valid `ownerId` matching an existing user.
- `BookDetails` must be 1-to-1 with a `Book` (sharing the same ID).
- Only the owner of a library or users in `sharedWith` can read/write books in it.
- Only the owner of a library can edit library settings (name, sharing).

## 2. The "Dirty Dozen" Payloads (Denial Expected)

1. **Identity Spoofing**: Update a book in a library you don't own/aren't shared with.
2. **Library Hijack**: Change `ownerId` of a library during update.
3. **Empty Title**: Create a book with an empty `title` string.
4. **Huge Title**: Create a book with a 1MB `title` string (Denial of Wallet).
5. **Orphaned Write**: Create a book in a library ID that doesn't exist.
6. **Self-Promotion**: Add your email to `sharedWith` of a library you don't own.
7. **Type Poisoning**: Set `addedAt` as a boolean instead of a timestamp.
8. **Shadow Field**: Add a `isVerified: true` hidden field to a book document.
9. **Duplicate ID Poisoning**: Create an `allowedDuplicate` with 50,000 IDs.
10. **Book Detail Leak**: Read `bookDetails` for a library you don't have access to.
11. **Review Spam**: Create a review for a book as another user ID.
12. **Immutable Field Attack**: Try to change `createdAt` of a library.

## 3. Test Runner (Conceptual) - firestore.rules.test.ts
```typescript
// Conceptual tests
it('denies update to book in unowned library', async () => {
  const db = getFirestore(otherAuth);
  await assertFails(updateDoc(doc(db, 'libraries/lib1/books/book1'), {title: 'New Title'}));
});

it('denies shadow field injection', async () => {
  const db = getFirestore(ownerAuth);
  await assertFails(updateDoc(doc(db, 'libraries/lib1/books/book1'), {title: 'New Title', admin: true}));
});
```
