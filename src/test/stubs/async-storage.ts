// A stand-in for AsyncStorage in unit tests (see vitest.config.ts).
const AsyncStorage = {
  multiGet: async (keys: readonly string[]): Promise<[string, string | null][]> =>
    keys.map((k): [string, string | null] => [k, null]),
  multiSet: async (): Promise<void> => {},
  multiRemove: async (): Promise<void> => {},
}

export default AsyncStorage
