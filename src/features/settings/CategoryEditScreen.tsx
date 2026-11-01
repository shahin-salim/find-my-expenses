/**
 * Creating a category, and editing one.
 *
 * `screens/Categories-create.png`. The same screen does both, because the
 * fields are the same and an edit is the create form with the row in it.
 *
 * A built-in category can be renamed and restyled but not archived — section
 * 8.2: "Shipped default category; can be renamed but not deleted." Renaming
 * is safe because the automatic rules map to `system_key`, never to the name
 * on screen.
 */

import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  archiveCategory,
  categoryNameInUse,
  categoryUsage,
  createCategory,
  findCategoryById,
  updateCategory,
} from '../../core/db/dao/categories';
import {
  COLOR_CHOICES,
  ICON_CHOICES,
} from '../../core/categorization/defaultCategories';
import { categoryColor, pressedDim, pressedFill, useTheme } from '../../design';
import { Button, Icon, Text, iconName } from '../../design/components';
import type { ScreenProps } from '../../navigation/types';
import { useApp } from '../../state/AppProvider';

/**
 * The icons and colours a category can have — taken from the one list the
 * defaults are defined from, not a copy.
 *
 * A copy is how this screen came to offer sixteen icons that did not include
 * the one Food & Dining ships with, and eight colours out of sixteen, so a
 * built-in category could not be returned to its own appearance after a
 * single tap.
 */
const ICONS: readonly string[] = ICON_CHOICES;
const COLORS: readonly string[] = COLOR_CHOICES;

const MAX_NAME = 24;

export function CategoryEditScreen({ navigation, route }: ScreenProps<'CategoryEdit'>) {
  const theme = useTheme();
  const { db } = useApp();
  const editingId = route.params?.id;

  const existing = useMemo(
    () => (editingId ? findCategoryById(db, editingId) : null),
    [db, editingId],
  );
  const inUse = useMemo(
    () => (editingId ? categoryUsage(db).get(editingId)?.transactions ?? 0 : 0),
    [db, editingId],
  );

  const [name, setName] = useState(existing?.name ?? '');
  const [icon, setIcon] = useState(existing?.icon ?? 'circle');
  const [color, setColor] = useState<string>(existing?.color ?? 'green');
  const [excluded, setExcluded] = useState(existing?.excluded_from_totals === 1);
  const [fixedCost, setFixedCost] = useState(existing?.is_fixed_cost === 1);
  const [tracksRepayment, setTracksRepayment] = useState(
    existing?.tracks_repayment === 1,
  );
  const [touched, setTouched] = useState(false);

  const trimmed = name.trim();
  const palette = categoryColor(theme, color);

  const error = !touched
    ? null
    : trimmed.length === 0
    ? 'Give it a name'
    : trimmed.length > MAX_NAME
    ? `Up to ${MAX_NAME} characters`
    : categoryNameInUse(db, trimmed, editingId)
    ? 'Must be different from your other categories'
    : null;

  const canSave =
    trimmed.length > 0 &&
    trimmed.length <= MAX_NAME &&
    !categoryNameInUse(db, trimmed, editingId);

  const save = () => {
    setTouched(true);
    if (!canSave) {
      return;
    }
    if (editingId) {
      updateCategory(db, editingId, {
        name: trimmed, icon, color,
        excludedFromTotals: excluded, isFixedCost: fixedCost,
        tracksRepayment,
      });
    } else {
      createCategory(db, {
        name: trimmed, icon, color,
        excludedFromTotals: excluded, isFixedCost: fixedCost,
        tracksRepayment,
      });
    }
    navigation.goBack();
  };

  const confirmArchive = () => {
    Alert.alert(
      `Archive ${existing?.name}?`,
      inUse > 0
        ? `It will stop appearing when you pick a category. The ${inUse} payment${
            inUse === 1 ? '' : 's'
          } already filed under it keep it, so your spending history does not change.`
        : 'It will stop appearing when you pick a category.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: () => {
            archiveCategory(db, editingId!);
            navigation.goBack();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.color.background }}
      edges={['top']}>
      <View style={[styles.bar, { paddingHorizontal: theme.space(4) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [
            styles.barButton,
            { backgroundColor: theme.color.surface, borderRadius: theme.radius.md },
            pressedFill(theme, pressed),
          ]}>
          <Icon name="close" size={18} color={theme.color.textPrimary} />
        </Pressable>
        <Text variant="subheading">{editingId ? 'Edit category' : 'New category'}</Text>
        <View style={styles.barButton} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: theme.space(4),
            paddingBottom: theme.space(8),
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* The preview is the point of the picker: a name, an icon and a
              colour chosen apart from each other often look wrong together. */}
          <View
            style={[
              styles.preview,
              {
                backgroundColor: theme.color.surface,
                borderRadius: theme.radius.lg,
                padding: theme.space(4),
                marginTop: theme.space(2),
              },
            ]}>
            <View
              style={[
                styles.previewIcon,
                { backgroundColor: palette.soft, borderRadius: theme.radius.md },
              ]}>
              <Icon name={iconName(icon)} size={22} color={palette.onSoft} />
            </View>
            <View style={styles.previewBody}>
              <Text variant="caption" tone="secondary">
                Preview
              </Text>
              <Text variant="subheading" numberOfLines={1}>
                {trimmed.length > 0 ? trimmed : 'Your category'}
              </Text>
            </View>
          </View>

          <Text variant="label" tone="secondary" style={{ marginTop: theme.space(5) }}>
            Name
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            onBlur={() => setTouched(true)}
            placeholder="Travel trips"
            placeholderTextColor={theme.color.textMuted}
            maxLength={MAX_NAME}
            style={[
              styles.input,
              {
                backgroundColor: theme.color.surface,
                borderRadius: theme.radius.lg,
                borderColor: error ? theme.color.danger : theme.color.primary,
                color: theme.color.textPrimary,
                marginTop: theme.space(2),
              },
            ]}
          />
          <Text
            variant="caption"
            tone={error ? 'danger' : 'muted'}
            style={{ marginTop: theme.space(1) }}>
            {error ?? `Up to ${MAX_NAME} characters. Must be different from your other categories.`}
          </Text>

          <Text variant="label" tone="secondary" style={{ marginTop: theme.space(5) }}>
            Icon
          </Text>
          <View style={[styles.grid, { marginTop: theme.space(2) }]}>
            {ICONS.map((option) => {
              const active = icon === option;
              return (
                <View key={option} style={styles.iconCell}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={option}
                    accessibilityState={{ selected: active }}
                    onPress={() => setIcon(option)}
                    style={({ pressed }) => [
                      styles.iconTile,
                      pressedDim(pressed),
                      {
                        borderRadius: theme.radius.md,
                        backgroundColor: active
                          ? theme.color.selected
                          : theme.color.surface,
                        borderColor: active ? theme.color.selected : theme.color.border,
                      },
                    ]}>
                    <Icon
                      name={iconName(option)}
                      size={20}
                      color={active ? theme.color.onSelected : theme.color.textPrimary}
                    />
                  </Pressable>
                </View>
              );
            })}
          </View>

          <Text variant="label" tone="secondary" style={{ marginTop: theme.space(5) }}>
            Colour
          </Text>
          <View style={[styles.swatches, { marginTop: theme.space(2) }]}>
            {COLORS.map((token) => {
              const active = color === token;
              return (
                <View key={token} style={styles.swatchCell}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={token}
                    accessibilityState={{ selected: active }}
                    onPress={() => setColor(token)}
                    style={({ pressed }) => [
                      styles.swatchRing,
                      pressedDim(pressed),
                      { borderColor: active ? theme.color.textPrimary : 'transparent' },
                    ]}>
                    <View
                      style={[
                        styles.swatch,
                        { backgroundColor: categoryColor(theme, token).solid },
                      ]}
                    />
                  </Pressable>
                </View>
              );
            })}
          </View>

          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.color.surface,
                borderRadius: theme.radius.lg,
                padding: theme.space(4),
                marginTop: theme.space(5),
              },
            ]}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleBody}>
                <Text variant="bodyStrong">Leave out of spending totals</Text>
                <Text variant="caption" tone="secondary">
                  For money you move, like investments or savings.
                </Text>
              </View>
              <Switch
                value={excluded}
                onValueChange={setExcluded}
                trackColor={{ true: theme.color.primary, false: theme.color.borderStrong }}
                thumbColor={theme.color.surface}
              />
            </View>

            <View
              style={[
                styles.toggleRow,
                { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.border },
              ]}>
              <View style={styles.toggleBody}>
                <Text variant="bodyStrong">Treat as a fixed cost</Text>
                {/* Section 8.2: "Rent, bills and SIPs recur at a size that
                    drowns out everyday spending." This is the flag Home's
                    "Everyday spending" filter reads. */}
                <Text variant="caption" tone="secondary">
                  Hidden when Home is showing everyday spending.
                </Text>
              </View>
              <Switch
                value={fixedCost}
                onValueChange={setFixedCost}
                trackColor={{ true: theme.color.primary, false: theme.color.borderStrong }}
                thumbColor={theme.color.surface}
              />
            </View>

            <View
              style={[
                styles.toggleRow,
                { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.border },
              ]}>
              <View style={styles.toggleBody}>
                <Text variant="bodyStrong">Ask if the money came back</Text>
                {/* Lend ships with this on. It is offered on every category
                    rather than kept to that one row, because a person who
                    lends often tends to want a category per borrower, and
                    the question is just as useful on each of them. */}
                <Text variant="caption" tone="secondary">
                  For money you lend. Payments here can be marked as paid
                  back, and stop counting when they are.
                </Text>
              </View>
              <Switch
                value={tracksRepayment}
                onValueChange={setTracksRepayment}
                trackColor={{ true: theme.color.primary, false: theme.color.borderStrong }}
                thumbColor={theme.color.surface}
              />
            </View>
          </View>

          {existing && existing.is_system === 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={confirmArchive}
              style={({ pressed }) => [
                styles.archive,
                {
                  borderColor: theme.color.danger,
                  borderRadius: theme.radius.lg,
                  backgroundColor: pressed ? theme.color.dangerSoft : 'transparent',
                  marginTop: theme.space(4),
                },
              ]}>
              <Text variant="bodyStrong" tone="danger">
                Archive category
              </Text>
            </Pressable>
          ) : null}

          {existing && existing.is_system === 1 ? (
            <Text variant="caption" tone="muted" style={{ marginTop: theme.space(4) }}>
              Built-in categories can be renamed and restyled, but not archived —
              the automatic rules keep pointing at this one whatever you call it.
            </Text>
          ) : null}
        </ScrollView>

        <View style={{ padding: theme.space(4) }}>
          <Button
            label={editingId ? 'Save changes' : 'Save category'}
            onPress={save}
            disabled={touched && !canSave}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8,
  },
  barButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  previewIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  previewBody: { flex: 1, gap: 2 },
  input: { borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15 },
  /**
   * Cells at an exact fraction, with the gap as padding inside them.
   *
   * `space-between` with a percentage width leaves a remainder, and a part
   * row then spreads its two items to opposite edges. `alignContent` has to
   * be pinned too: a wrapping row stretches its lines by default, which was
   * the band of dead space under the grid.
   */
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    alignContent: 'flex-start', marginHorizontal: -4,
  },
  iconCell: { width: '25%', padding: 4 },
  iconTile: {
    aspectRatio: 1.15, alignItems: 'center',
    justifyContent: 'center', borderWidth: 1,
  },
  swatches: {
    flexDirection: 'row', flexWrap: 'wrap',
    alignContent: 'flex-start', marginHorizontal: -4,
  },
  swatchCell: { width: '12.5%', padding: 4 },
  swatchRing: {
    aspectRatio: 1, borderRadius: 999, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  swatch: { width: '74%', aspectRatio: 1, borderRadius: 999 },
  card: {},
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  toggleBody: { flex: 1, gap: 2 },
  archive: { alignItems: 'center', paddingVertical: 15, borderWidth: 1 },
});
