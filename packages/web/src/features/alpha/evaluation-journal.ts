import {
  AlphaEvaluationOutcomeSchema,
  AlphaEvaluationJournalRecordSchema,
  AlphaEvaluationResponseSchema,
  type AlphaEvaluationOutcome,
  type AlphaEvaluationResponse,
} from '@oggregator/protocol';

const DATABASE = 'alpha-evaluations-v1';
const MAX_EVALUATIONS = 500;

async function withDatabase<T>(action: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore('evaluations', { keyPath: 'id' });
      request.result.createObjectStore('outcomes', { keyPath: 'evaluationId' });
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('Journal could not open'));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Close other Alpha tabs to upgrade the journal'));
    };
  });
  db.onversionchange = () => db.close();
  try {
    return await action(db);
  } finally {
    db.close();
  }
}

function value<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Journal request failed'));
  });
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Journal transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Journal write failed'));
  });
}

export async function saveEvaluation(evaluation: AlphaEvaluationResponse): Promise<void> {
  const snapshot = AlphaEvaluationResponseSchema.parse(evaluation);
  const savedAt = Date.now();
  if (snapshot.evaluatedAt > savedAt + 1_000) throw new Error('Evaluation time is in the future');
  await withDatabase(async (db) => {
    const transaction = db.transaction('evaluations', 'readwrite');
    const done = committed(transaction);
    const store = transaction.objectStore('evaluations');
    const count = await value(store.count());
    if (count >= MAX_EVALUATIONS) {
      await done;
      throw new Error('Journal full (500 evaluations). Export and remove old records first.');
    }
    store.add({ ...snapshot, savedAt });
    await done;
  });
}

export async function readEvaluationJournal() {
  return withDatabase(async (db) => {
    const transaction = db.transaction(['evaluations', 'outcomes'], 'readonly');
    const done = committed(transaction);
    const [evaluations, outcomes] = await Promise.all([
      value(transaction.objectStore('evaluations').getAll()),
      value(transaction.objectStore('outcomes').getAll()),
    ]);
    await done;
    return {
      evaluations: evaluations
        .map((entry: unknown) => AlphaEvaluationJournalRecordSchema.parse(entry))
        .sort((a, b) => b.evaluatedAt - a.evaluatedAt),
      outcomes: outcomes.map((entry: unknown) => AlphaEvaluationOutcomeSchema.parse(entry)),
    };
  });
}

export async function saveEvaluationOutcome(outcome: AlphaEvaluationOutcome): Promise<void> {
  const parsed = AlphaEvaluationOutcomeSchema.parse(outcome);
  await withDatabase(async (db) => {
    const transaction = db.transaction(['evaluations', 'outcomes'], 'readwrite');
    const done = committed(transaction);
    const raw: unknown = await value(
      transaction.objectStore('evaluations').get(parsed.evaluationId),
    );
    const evaluation = AlphaEvaluationJournalRecordSchema.parse(raw);
    if (
      parsed.closedAt < evaluation.evaluatedAt ||
      parsed.closedAt < evaluation.savedAt ||
      parsed.recordedAt > Date.now() + 1_000 ||
      (parsed.kind === 'expiry' && parsed.closedAt < evaluation.request.candidate.expiryTs)
    ) {
      await done;
      throw new Error('Outcome time does not match the saved evaluation');
    }
    transaction.objectStore('outcomes').add(parsed);
    await done;
  });
}

export async function removeEvaluation(id: string): Promise<void> {
  await withDatabase(async (db) => {
    const transaction = db.transaction(['evaluations', 'outcomes'], 'readwrite');
    const done = committed(transaction);
    transaction.objectStore('evaluations').delete(id);
    transaction.objectStore('outcomes').delete(id);
    await done;
  });
}
