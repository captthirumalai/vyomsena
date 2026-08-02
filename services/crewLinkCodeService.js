import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp
} from './firestoreService.js';
import { validateContract } from './schemaContract.js';

const CREW_LINK_CODES = 'crew_link_codes';
const FIVE_MINUTES_MS = 5 * 60 * 1000;

function generateCode() {
  return `${Math.floor(100000 + Math.random() * 900000)}`;
}

function toDateValue(value) {
  const raw = value?.toDate ? value.toDate() : value;
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

export async function createCrewLinkCode({ crewProfileId, operatorId, validityMs = FIVE_MINUTES_MS }) {
  if (!crewProfileId || !operatorId) {
    throw new Error('crewProfileId and operatorId are required for link code generation.');
  }

  const activeCodesQuery = query(
    collection(CREW_LINK_CODES),
    where('operatorId', '==', operatorId),
    where('crewProfileId', '==', crewProfileId),
    where('used', '==', false)
  );

  try {
    const activeSnapshot = await getDocs(activeCodesQuery);
    const now = Date.now();
    await Promise.all(
      activeSnapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((item) => {
          const expiresAt = toDateValue(item.expiresAt);
          return expiresAt && expiresAt.getTime() > now;
        })
        .map((item) =>
          updateDoc(doc(CREW_LINK_CODES, item.id), {
            used: true,
            status: 'SUPERSEDED',
            lastModified: serverTimestamp()
          })
        )
    );
  } catch (error) {
    console.warn('createCrewLinkCode: supersede of previous codes skipped.', error);
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + validityMs);
  const payload = {
    crewProfileId,
    operatorId,
    code,
    used: false,
    status: 'ACTIVE',
    expiresAt,
    createdAt: serverTimestamp(),
    lastModified: serverTimestamp()
  };

  validateContract('crew_link_codes', payload, 'createCrewLinkCode', 'write');
  const createdRef = await addDoc(collection(CREW_LINK_CODES), payload);
  await updateDoc(createdRef, { tokenId: createdRef.id });

  return {
    tokenId: createdRef.id,
    ...payload
  };
}
