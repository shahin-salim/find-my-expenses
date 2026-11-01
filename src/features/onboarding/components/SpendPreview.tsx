import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../../design/components';
import { useTheme } from '../../../design';

/**
 * The illustration at the top of the welcome screen: the bubble chart the user
 * will see on Home, with one transaction landing in a category. It is drawn
 * rather than shipped as an image so it follows the theme.
 */
export function SpendPreview() {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="A preview of spending split by category, with a Swiggy payment sorted into Food"
      style={[
        styles.frame,
        {
          backgroundColor: theme.category.green.soft,
          borderRadius: theme.radius.xl,
        },
      ]}>
      <View style={styles.bubbles}>
        <View
          style={[
            styles.bubble,
            { width: 112, height: 112, backgroundColor: theme.category.red.solid },
          ]}>
          <Text variant="caption" style={{ color: '#FFFFFF' }}>
            Food
          </Text>
          <Text variant="subheading" tabular style={{ color: '#FFFFFF' }}>
            ₹8,950
          </Text>
        </View>

        <View
          style={[
            styles.bubble,
            { width: 84, height: 84, backgroundColor: '#D9796D' },
          ]}>
          <Text variant="caption" style={{ color: '#FFFFFF' }}>
            Shopping
          </Text>
          <Text variant="label" tabular style={{ color: '#FFFFFF' }}>
            ₹5,480
          </Text>
        </View>

        <View
          style={[styles.bubble, { width: 60, height: 60, backgroundColor: '#EFB3AC' }]}
        />
        <View
          style={[
            styles.bubble,
            { width: 34, height: 34, backgroundColor: theme.category.grey.solid },
          ]}
        />
      </View>

      <View
        style={[
          styles.toast,
          { backgroundColor: theme.color.surface, borderRadius: theme.radius.md },
        ]}>
        <View
          style={[
            styles.toastBadge,
            {
              backgroundColor: theme.category.green.soft,
              borderRadius: theme.radius.sm,
            },
          ]}>
          <Text variant="label" style={{ color: theme.category.green.onSoft }}>
            S
          </Text>
        </View>
        <View style={styles.toastBody}>
          <Text variant="bodyStrong">Swiggy −₹386</Text>
          <Text variant="caption" tone="accent">
            ✓ Added to Food
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { padding: 18, paddingBottom: 14, overflow: 'hidden' },
  bubbles: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    minHeight: 120,
  },
  bubble: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    marginTop: -18,
    marginLeft: 56,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  toastBadge: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  toastBody: { gap: 1 },
});
