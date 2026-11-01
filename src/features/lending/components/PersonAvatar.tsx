import React from 'react';
import { View } from 'react-native';
import { categoryColor, useTheme } from '../../../design';
import { Text } from '../../../design/components';

/** The colours a person's tile is drawn in, picked from their name. */
const SHADES = ['violet', 'blue', 'teal', 'amber', 'pink', 'lime', 'sky', 'orange'];

/**
 * The initials tile beside a lend.
 *
 * Section 12.6's list is read down the left edge, and a row of identical
 * circles would make the people harder to tell apart rather than easier. The
 * colour is derived from the name so that one person keeps the same tile
 * everywhere, with no colour stored against them anywhere.
 */
export function PersonAvatar({ name, size = 44 }: { name: string; size?: number }) {
  const theme = useTheme();

  const initials =
    name
      .replace(/[^\p{L} ]/gu, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0] ?? '')
      .join('')
      .toUpperCase() || '?';

  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 100_000;
  }
  const palette = categoryColor(theme, SHADES[hash % SHADES.length]!);

  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: palette.soft,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text variant="label" style={{ color: palette.onSoft }}>
        {initials}
      </Text>
    </View>
  );
}
