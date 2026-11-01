import React from 'react';
import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { useTheme, type Theme } from '../index';

type Variant = keyof Theme['type'];
type Tone = 'primary' | 'secondary' | 'muted' | 'inverse' | 'accent' | 'danger' | 'up';

export interface AppTextProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
  /** Lines up digits in columns of amounts. */
  tabular?: boolean;
}

export function Text({
  variant = 'body',
  tone = 'primary',
  tabular,
  style,
  ...rest
}: AppTextProps) {
  const theme = useTheme();
  const tones: Record<Tone, string> = {
    primary: theme.color.textPrimary,
    secondary: theme.color.textSecondary,
    muted: theme.color.textMuted,
    inverse: theme.color.textInverse,
    accent: theme.color.primaryText,
    danger: theme.color.danger,
    up: theme.color.up,
  };

  const base: TextStyle = {
    ...theme.type[variant],
    color: tones[tone],
    ...(tabular ? { fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] } : null),
  };

  return <RNText {...rest} style={[base, style]} />;
}
