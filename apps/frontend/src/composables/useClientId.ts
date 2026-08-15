const KEY = 'nv:client-id:v1';
let memoryId: string | null = null;

export function useClientId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // Private mode must still have a stable owner for this page lifetime.
    memoryId ??= crypto.randomUUID();
    return memoryId;
  }
}
