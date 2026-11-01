import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../index';

export interface ProgressBarProps {
  /** 0 to 1. Values outside that range are clamped. */
  value: number;
  /** Shown while the total is still unknown. */
  indeterminate?: boolean;
}

export function ProgressBar({ value, indeterminate }: ProgressBarProps) {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={
        indeterminate ? undefined : { min: 0, max: 100, now: Math.round(clamped * 100) }
      }
      style={{
        height: 6,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.color.surfaceMuted,
        overflow: 'hidden',
      }}>
      <View
        style={{
          height: '100%',
          width: indeterminate ? '35%' : `${clamped * 100}%`,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.color.primary,
        }}
      />
    </View>
  );
}
