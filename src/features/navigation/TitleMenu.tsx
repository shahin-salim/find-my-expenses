/**
 * The page title, and the menu behind it.
 *
 * `screens/Navigation · title menu.png`: the title carries a chevron, and
 * tapping it drops a short list of the pages the app has, with a tick against
 * the one being looked at. It is the app's whole navigation — there is no tab
 * bar — so it lives next to the title rather than in a drawer nobody opens.
 */

import type { NavigationProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { pressedDim, useTheme } from '../../design';
import { Icon, Text } from '../../design/components';
import type { RootStackParamList } from '../../navigation/types';

type Page = 'Home' | 'Transactions' | 'Lending';

const PAGES: Array<{ page: Page; label: string; icon: 'home' | 'list' | 'lend' }> = [
  { page: 'Home', label: 'Home', icon: 'home' },
  { page: 'Transactions', label: 'Transactions', icon: 'list' },
  // Section 12.6. Not spending, so it is a destination of its own rather
  // than a card on Home: lent money must never be added to a spending total.
  { page: 'Lending', label: 'Lending', icon: 'lend' },
];

export function TitleMenu({
  current,
  navigation,
}: {
  current: Page;
  navigation: NavigationProp<RootStackParamList>;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  const go = (page: Page) => {
    setOpen(false);
    if (page === current) {
      return;
    }
    // `navigate` rather than `reset`, which is what this used to do.
    //
    // Resetting left the stack holding one screen, so the hardware back
    // button on Transactions had nothing behind it and closed the app. It
    // was written that way to stop the stack growing Home, Transactions,
    // Home — but `navigate` already prevents that: a stack navigator goes
    // back to a screen of that name when the stack already holds one, and
    // only pushes when it does not. Home is the first route, so going to
    // Transactions pushes once and going back to Home pops that one screen,
    // however many times the menu is used.
    navigation.navigate(page);
  };

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${current}. Open the page menu`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.title, pressedDim(pressed)]}
        hitSlop={8}>
        <Text variant="title">{current}</Text>
        <Icon name="chevron-down" size={22} color={theme.color.textPrimary} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close the menu"
          style={styles.backdrop}
          onPress={() => setOpen(false)}
        />
        {/* Anchored under the title rather than centred, because the title is
            what was tapped and the menu has to look like it came from it. */}
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.color.surface,
              borderRadius: theme.radius.lg,
              shadowColor: '#000',
            },
          ]}>
          {PAGES.map(({ page, label, icon }) => {
            const active = page === current;
            return (
              <Pressable
                key={page}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: active }}
                onPress={() => go(page)}
                style={({ pressed }) => [
                  styles.item,
                  {
                    backgroundColor: active
                      ? theme.category.green.soft
                      : pressed
                      ? theme.color.surfaceMuted
                      : 'transparent',
                    borderRadius: theme.radius.md,
                  },
                ]}>
                <Icon
                  name={icon}
                  size={18}
                  color={active ? theme.color.primaryText : theme.color.textPrimary}
                />
                <Text
                  variant="bodyStrong"
                  style={[
                    styles.itemLabel,
                    active ? { color: theme.color.primaryText } : null,
                  ]}>
                  {label}
                </Text>
                {active ? (
                  <Icon name="check" size={18} color={theme.color.primaryText} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backdrop: { flex: 1 },
  sheet: {
    position: 'absolute',
    // Clear of the status bar and the date line above the title.
    top: 108,
    left: 16,
    minWidth: 232,
    padding: 8,
    gap: 2,
    elevation: 8,
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  itemLabel: { flex: 1 },
});
