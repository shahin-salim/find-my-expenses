import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { darkTheme, lightTheme, type Theme } from './theme';

export type ThemePreference = 'SYSTEM' | 'LIGHT' | 'DARK';

const ThemeContext = createContext<Theme>(lightTheme);

export function ThemeProvider({
  preference,
  children,
}: {
  preference: ThemePreference;
  children: React.ReactNode;
}) {
  const system = useColorScheme();
  const theme = useMemo(() => {
    const resolved = preference === 'SYSTEM' ? system ?? 'light' : preference.toLowerCase();
    return resolved === 'dark' ? darkTheme : lightTheme;
  }, [preference, system]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
