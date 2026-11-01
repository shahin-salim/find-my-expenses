import React from 'react';
import { View, type ViewProps, type ViewStyle } from 'react-native';
import { useTheme } from '../index';

export interface CardProps extends ViewProps {
  padded?: boolean;
  style?: ViewStyle | ViewStyle[];
}

export function Card({ padded = true, style, ...rest }: CardProps) {
  const theme = useTheme();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: theme.color.surface,
          borderRadius: theme.radius.xl,
          padding: padded ? theme.space(5) : 0,
        },
        style,
      ]}
    />
  );
}
