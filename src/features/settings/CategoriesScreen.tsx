/**
 * Section 8.2, the categories themselves.
 *
 * Every row carries what it is actually holding. The decisions made here —
 * rename this, archive that, make this one a fixed cost — cannot be made
 * sensibly without knowing which categories the money is in.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatRupees } from '../../core/analytics/spending';
import { useDataVersion } from '../../core/db/changes';
import {
  categoryUsage,
  listCategories,
  unarchiveCategory,
  type CategoryUsage,
} from '../../core/db/dao/categories';
import type { CategoryRow } from '../../core/db/models';
import { categoryColor, pressedDim, pressedFill, useTheme } from '../../design';
import { Icon, Text, iconName } from '../../design/components';
import type { ScreenProps } from '../../navigation/types';
import { useApp } from '../../state/AppProvider';

export function CategoriesScreen({ navigation }: ScreenProps<'Categories'>) {
  const theme = useTheme();
  const { db } = useApp();
  const changed = useDataVersion();

  const read = useCallback(
    () => ({
      categories: listCategories(db, true),
      usage: categoryUsage(db),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, changed],
  );

  const [{ categories, usage }, setData] = useState(read);
  useEffect(() => setData(read()), [read]);

  const active = categories.filter((category) => category.is_archived === 0);
  const archived = categories.filter((category) => category.is_archived === 1);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.color.background }}
      edges={['top']}>
      <View style={[styles.bar, { paddingHorizontal: theme.space(4) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [
            styles.barButton,
            { backgroundColor: theme.color.surface, borderRadius: theme.radius.md },
            pressedFill(theme, pressed),
          ]}>
          <Icon name="chevron-left" size={20} color={theme.color.textPrimary} />
        </Pressable>
        <Text variant="subheading">Categories</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New category"
          onPress={() => navigation.navigate('CategoryEdit', {})}
          style={({ pressed }) => [
            styles.barButton,
            pressedDim(pressed),
            { backgroundColor: theme.color.primary, borderRadius: theme.radius.md },
          ]}>
          <Icon name="plus" size={20} color={theme.color.onPrimary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.space(4),
          paddingBottom: theme.space(10),
        }}
        showsVerticalScrollIndicator={false}>
        <View
          style={[
            styles.group,
            {
              backgroundColor: theme.color.surface,
              borderRadius: theme.radius.lg,
              paddingHorizontal: theme.space(4),
              marginTop: theme.space(2),
            },
          ]}>
          {active.map((category, index) => (
            <CategoryItem
              key={category.id}
              category={category}
              usage={usage.get(category.id)}
              divider={index > 0}
              onPress={() => navigation.navigate('CategoryEdit', { id: category.id })}
            />
          ))}
        </View>

        {archived.length > 0 ? (
          <>
            <Text variant="label" tone="secondary" style={{ marginTop: theme.space(6) }}>
              Archived
            </Text>
            <Text variant="caption" tone="muted" style={{ marginTop: theme.space(1) }}>
              Hidden when you pick a category. The payments already filed under
              them keep their name and colour.
            </Text>
            <View
              style={[
                styles.group,
                {
                  backgroundColor: theme.color.surface,
                  borderRadius: theme.radius.lg,
                  paddingHorizontal: theme.space(4),
                  marginTop: theme.space(2),
                },
              ]}>
              {archived.map((category, index) => (
                <CategoryItem
                  key={category.id}
                  category={category}
                  usage={usage.get(category.id)}
                  divider={index > 0}
                  dimmed
                  action="Restore"
                  onPress={() => {
                    unarchiveCategory(db, category.id);
                    setData(read());
                  }}
                />
              ))}
            </View>
          </>
        ) : null}

        <Text variant="caption" tone="muted" style={{ marginTop: theme.space(6) }}>
          Built-in categories can be renamed and restyled but not archived, so
          the automatic rules keep matching whatever you call them.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function CategoryItem({
  category,
  usage,
  divider,
  dimmed,
  action,
  onPress,
}: {
  category: CategoryRow;
  usage: CategoryUsage | undefined;
  divider: boolean;
  dimmed?: boolean;
  action?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const palette = categoryColor(theme, category.color);
  const count = usage?.transactions ?? 0;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        divider && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.color.border,
        },
        pressed && { backgroundColor: theme.color.surfaceMuted },
        dimmed && styles.dimmed,
      ]}>
      <View
        style={[
          styles.icon,
          { backgroundColor: palette.soft, borderRadius: theme.radius.md },
        ]}>
        <Icon name={iconName(category.icon)} size={18} color={palette.onSoft} />
      </View>

      <View style={styles.body}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {category.name}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {count === 0
            ? 'Nothing filed under it yet'
            : `${count.toLocaleString('en-IN')} payment${count === 1 ? '' : 's'} · ${formatRupees(
                usage?.total ?? 0,
              )}`}
          {category.is_fixed_cost === 1 ? ' · fixed cost' : ''}
          {category.excluded_from_totals === 1 ? ' · not in totals' : ''}
        </Text>
      </View>

      {action ? (
        <Text variant="label" tone="accent">
          {action}
        </Text>
      ) : (
        <Icon name="chevron-right" size={16} color={theme.color.textMuted} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8,
  },
  barButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  group: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 2 },
  dimmed: { opacity: 0.6 },
});
