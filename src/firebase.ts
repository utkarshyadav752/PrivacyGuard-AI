import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  collection,
  setDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function signOutUser() {
  return firebaseSignOut(auth);
}

export interface SanitizedAuditLogInput {
  id: string;
  actionType: 'photo_protect' | 'link_clean' | 'batch_protect' | 'ai_placeholder';
  summary: string;
  riskLevel: 'Low' | 'Moderate' | 'High';
  itemsRemovedCount: number;
  verifiedLocal: boolean;
}

export async function saveCloudAuditRecord(input: SanitizedAuditLogInput) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const safeId = input.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || `log_${Date.now()}`;
  const path = `users/${user.uid}/auditLogs/${safeId}`;
  const safeSummary = input.summary.slice(0, 280);
  const safeCount = Math.max(0, Math.min(10000, Math.floor(input.itemsRemovedCount)));

  try {
    await setDoc(doc(db, 'users', user.uid, 'auditLogs', safeId), {
      ownerId: user.uid,
      actionType: input.actionType,
      summary: safeSummary,
      riskLevel: input.riskLevel,
      itemsRemovedCount: safeCount,
      verifiedLocal: Boolean(input.verifiedLocal),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteCloudAuditRecord(logId: string) {
  const user = auth.currentUser;
  if (!user) return;
  const safeId = logId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const path = `users/${user.uid}/auditLogs/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', user.uid, 'auditLogs', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeToCloudAuditLogs(
  userId: string,
  onRecords: (records: Array<SanitizedAuditLogInput & { timestamp: string }>) => void
) {
  const path = `users/${userId}/auditLogs`;
  const q = query(collection(db, 'users', userId, 'auditLogs'), orderBy('createdAt', 'desc'), limit(30));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => {
        const data = d.data();
        const ts = data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString();
        return {
          id: d.id,
          actionType: data.actionType,
          summary: data.summary,
          riskLevel: data.riskLevel,
          itemsRemovedCount: data.itemsRemovedCount,
          verifiedLocal: data.verifiedLocal,
          timestamp: ts,
        };
      });
      onRecords(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}
