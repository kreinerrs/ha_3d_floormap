export type LockStatus = 'locked' | 'unlocked' | 'unavailable';

/**
 * Maps a Home Assistant lock state to the status shown on the door.
 * @param state Raw entity state, for example `locked`, `unlocking` or `jammed`.
 * @returns `locked` for locked/locking, `unlocked` for unlocked/open/unlocking/opening/jammed, otherwise `unavailable`.
 */
export function lockView(state: string | undefined): LockStatus {
  if (state === 'locked' || state === 'locking') return 'locked';
  if (state === 'unlocked' || state === 'open' || state === 'opening' || state === 'unlocking' || state === 'jammed') return 'unlocked';
  return 'unavailable';
}

/**
 * Colour used for lock symbols and door strips.
 * @param status Lock status.
 * @returns A CSS colour: red when locked, green when unlocked, grey when unknown.
 */
export function lockColor(status: LockStatus): string {
  return status === 'locked' ? '#d93025' : status === 'unlocked' ? '#2e9e49' : '#8a8a8a';
}
