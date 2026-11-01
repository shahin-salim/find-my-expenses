import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ActivityIndicator, View } from 'react-native';
import { getProfile, updateProfile } from '../core/db/dao/profile';
import { appDatabase } from '../core/db/instance';
import type { ProfileRow } from '../core/db/models';
import type { SqlDatabase } from '../core/db/types';
import { ThemeProvider, lightTheme } from '../design';
import { useLiveSms } from '../features/sms/useLiveSms';

interface AppContextValue {
  db: SqlDatabase;
  profile: ProfileRow;
  /** Re-reads the profile row after something has written to it. */
  reloadProfile: () => void;
  patchProfile: (changes: Partial<ProfileRow>) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<SqlDatabase | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    try {
      // The schema and the rows the app assumes exist: cash as an account,
      // the default categories, and the single profile row. Shared with the
      // headless task in section 6.1, which may have opened it already.
      const opened = appDatabase();
      setDb(opened);
      setProfile(getProfile(opened));
    } catch (openError) {
      setError(openError as Error);
    }
  }, []);

  // Section 1.2. Mounted here rather than on a screen, so a message arriving
  // is picked up wherever the user happens to be.
  useLiveSms(db);

  const reloadProfile = useCallback(() => {
    if (db) {
      setProfile(getProfile(db));
    }
  }, [db]);

  const patchProfile = useCallback(
    (changes: Partial<ProfileRow>) => {
      if (!db) {
        return;
      }
      updateProfile(db, changes);
      setProfile(getProfile(db));
    },
    [db],
  );

  const value = useMemo<AppContextValue | null>(
    () => (db && profile ? { db, profile, reloadProfile, patchProfile } : null),
    [db, profile, reloadProfile, patchProfile],
  );

  if (error) {
    throw error;
  }

  if (!value) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: lightTheme.color.background,
        }}>
        <ActivityIndicator color={lightTheme.color.primary} />
      </View>
    );
  }

  return (
    <AppContext.Provider value={value}>
      <ThemeProvider preference={value.profile.theme}>{children}</ThemeProvider>
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) {
    throw new Error('useApp must be used inside AppProvider');
  }
  return value;
}

export function useDatabase(): SqlDatabase {
  return useApp().db;
}
