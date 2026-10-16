/**
 * Company membership foundation (Phase C3 Block 1, P2).
 *
 * Invitation acceptance that ESTABLISHES membership — the previous flow only
 * stamped invite usage without linking the member to the company.
 *
 *   Invitation (company_invites/{code})
 *     → validate (exists, unexpired, unused-by-other)
 *     → upsert deterministic member row company_accounts/{redeemerUid}
 *     → mark usedBy/usedAt (first accept only)
 *     → return membership { accountId, companyId, uid, role }
 *
 * Compatibility rules (never break existing rows):
 *  - Pilot-linkage rows (role PILOT, no isMember) are UPGRADED in place
 *    (isMember: true) — never overwritten, never duplicated.
 *  - Unclaimed placeholder rows (uid null) are left untouched.
 *  - A member row for a DIFFERENT company blocks acceptance (no silent
 *    company switching).
 *  - Re-acceptance by the same redeemer is idempotent (returns membership,
 *    rewrites nothing).
 *  - NEVER touches crew_profiles, users, licences, documents, or Storage.
 *  - NEVER creates a Pilot.
 *
 * Takes an explicit `db` (Admin SDK in production, stub in tests).
 */

const INVITES = 'company_invites';
const ACCOUNTS = 'company_accounts';

function toMillis(value) {
  if (!value) return 0;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  const time = date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
  return time;
}

async function loadAccountRowsByUid(db, uid) {
  const snapshot = await db.collection(ACCOUNTS).where('uid', '==', uid).get();
  return snapshot.docs.map((item) => ({ accountId: item.id, ...item.data() }));
}

async function redeemCompanyInvite(db, { code, redeemerUid, now = new Date() } = {}) {
  const normalizedCode = `${code || ''}`.trim();
  if (!normalizedCode) throw new Error('Invite code is required.');
  if (!redeemerUid) throw new Error('An authenticated redeemer is required.');

  const inviteSnap = await db.doc(`${INVITES}/${normalizedCode}`).get();
  if (!inviteSnap.exists) {
    throw new Error('Invite code was not found.');
  }
  const invite = { code: normalizedCode, ...inviteSnap.data() };

  if (!invite.expiresAt || toMillis(invite.expiresAt) <= now.getTime()) {
    throw new Error('Invite code has expired. Ask the operator for a new one.');
  }

  if (invite.usedBy) {
    if (invite.usedBy === redeemerUid) {
      // Idempotent re-acceptance: return the existing membership, rewrite nothing.
      const rows = await loadAccountRowsByUid(db, redeemerUid);
      const member = rows.find((row) => row.isMember === true && row.companyId);
      if (!member) throw new Error('Invite was used but no membership exists. Ask the operator for a new one.');
      return {
        accountId: member.accountId || redeemerUid,
        companyId: member.companyId,
        uid: redeemerUid,
        role: member.role || invite.role || 'MEMBER'
      };
    }
    throw new Error('Invite code was already used.');
  }

  if (!invite.companyId) {
    throw new Error('Invite is missing its company. Ask the operator for a new one.');
  }

  const rows = await loadAccountRowsByUid(db, redeemerUid);
  const existingMember = rows.find((row) => row.isMember === true);

  let accountId = redeemerUid;
  if (existingMember) {
    if (existingMember.companyId !== invite.companyId) {
      throw new Error('This invite belongs to a different company.');
    }
    // Same-company re-invite: refresh admin intent, preserve everything else
    // (including a PILOT role marker — pilot linkage rows are never downgraded).
    const patch = {
      displayName: invite.displayName || existingMember.displayName || '',
      email: (invite.email || existingMember.email || '').toLowerCase() || null,
      lastModified: now
    };
    if (`${existingMember.role || ''}`.toUpperCase() !== 'PILOT' && invite.role) {
      patch.role = `${invite.role}`.trim().toUpperCase();
    }
    await db.doc(`${ACCOUNTS}/${existingMember.accountId || redeemerUid}`).update(patch);
    accountId = existingMember.accountId || redeemerUid;
  } else {
    const pilotRow = rows.find((row) => `${row.role || ''}`.trim().toUpperCase() === 'PILOT');
    if (pilotRow) {
      if (pilotRow.companyId && pilotRow.companyId !== invite.companyId) {
        throw new Error('This invite belongs to a different company.');
      }
      // Upgrade the pilot-linkage row in place: keep every pilot field,
      // add membership. The pilot record itself is never touched.
      await db.doc(`${ACCOUNTS}/${pilotRow.accountId || redeemerUid}`).update({
        isMember: true,
        companyId: invite.companyId,
        lastModified: now
      });
      accountId = pilotRow.accountId || redeemerUid;
    } else {
      // Fresh deterministic member row keyed by the redeemer UID: accepting
      // twice can never create a duplicate.
      accountId = redeemerUid;
      await db.doc(`${ACCOUNTS}/${accountId}`).set({
        accountId,
        companyId: invite.companyId,
        uid: redeemerUid,
        role: invite.role ? `${invite.role}`.trim().toUpperCase() : 'MEMBER',
        displayName: invite.displayName || '',
        email: (invite.email || '').toLowerCase() || null,
        isMember: true,
        status: 'ACTIVE',
        createdAt: now,
        lastModified: now
      });
    }
  }

  await db.doc(`${INVITES}/${normalizedCode}`).update({ usedBy: redeemerUid, usedAt: now });

  const finalSnap = await db.doc(`${ACCOUNTS}/${accountId}`).get();
  const final = finalSnap.exists ? finalSnap.data() : {};
  return {
    accountId,
    companyId: invite.companyId,
    uid: redeemerUid,
    role: final.role || invite.role || 'MEMBER'
  };
}

module.exports = {
  INVITES,
  ACCOUNTS,
  redeemCompanyInvite
};
