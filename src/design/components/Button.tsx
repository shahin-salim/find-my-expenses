import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { pressedDim, useTheme } from '../index';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  accessibilityHint?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  accessibilityHint,
}: ButtonProps) {
  const theme = useTheme();
  const inactive = disabled || loading;

  const surface: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: theme.color.primary },
    secondary: {
      backgroundColor: theme.color.surface,
      borderWidth: 1,
      borderColor: theme.color.border,
    },
    ghost: { backgroundColor: 'transparent' },
    danger: {
      backgroundColor: theme.color.surface,
      borderWidth: 1,
      borderColor: theme.color.danger,
    },
  };

  const labelTone =
    variant === 'primary' ? 'inverse' : variant === 'danger' ? 'danger' : 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      accessibilityHint={accessibilityHint}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { borderRadius: theme.radius.lg, paddingVertical: theme.space(4.5) },
        surface[variant],
        pressed && variant === 'primary' && { backgroundColor: theme.color.primaryPressed },
        variant !== 'primary' && pressedDim(pressed),
        inactive && styles.inactive,
        style,
      ]}>
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator
            color={variant === 'primary' ? theme.color.onPrimary : theme.color.primary}
          />
        ) : (
          <Text variant="subheading" tone={labelTone}>
            {label}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', minHeight: 54 },
  content: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inactive: { opacity: 0.5 },
});
